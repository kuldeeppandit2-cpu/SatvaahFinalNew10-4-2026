/**
 * LeadsScreen.tsx
 * SatvAAh · Phase 23 · Provider Leads
 *
 * Lead management: All / Pending / Accepted / Declined / Expired tabs.
 * Accept (Verdigris) / Decline (outline) / Defer (text) actions.
 * Decline reason bottom sheet. 48h expiry shown honestly.
 * Response Rate signal impact explained transparently.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getLeads, updateLead } from '../../api/provider.api';

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  saffron:     '#C8691A',
  deepInk:     '#1C1C2E',
  ivory:       '#FAF7F0',
  verdigris:   '#2E7D72',
  ltVerdigris: '#6BA89E',
  warmSand:    '#F0E4CC',
  terracotta:  '#C0392B',
  grey:        '#6B6560',
  white:       '#FFFFFF',
  border:      '#E8E0D0',
  bgLight:     '#F5F2EC',
} as const;

type LeadStatus = 'all' | 'pending' | 'accepted' | 'declined' | 'expired';
type ContactType = 'call' | 'message' | 'slot_booking';
type TrustTier = 'unverified' | 'basic' | 'trusted' | 'highly_trusted';
type LeadAction = 'accept' | 'decline' | 'defer';

const DECLINE_REASONS = [
  { id: 'too_far',       label: 'Too far away' },
  { id: 'wrong_cat',     label: 'Wrong category' },
  { id: 'fully_booked',  label: 'Fully booked' },
  { id: 'other',         label: 'Other' },
] as const;
type DeclineReasonId = typeof DECLINE_REASONS[number]['id'];

const FILTER_TABS: { key: LeadStatus; label: string }[] = [
  { key: 'all',      label: 'All'      },
  { key: 'pending',  label: 'Pending'  },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
  { key: 'expired',  label: 'Expired'  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConsumerBadge {
  trustTier:   TrustTier;
  trustScore:  number;
  displayName: string; // e.g. "Priya S." — first name + last initial
}

interface Lead {
  id:           string;
  contactType:  ContactType;
  status:       'pending' | 'accepted' | 'declined' | 'expired';
  consumer:     ConsumerBadge;
  createdAt:    string; // ISO timestamp
  expiresAt:    string; // ISO — 48h after created_at
  // area_hint / message_preview: not in ContactEvent schema — removed
}

interface MonthlyUsage {
  allocated: number;
  received:  number;
  accepted:  number;
  declined:  number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function expiryCountdown(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'Expired';
  const hrs  = Math.floor(remaining / 3_600_000);
  const mins = Math.floor((remaining % 3_600_000) / 60_000);
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    return `Expires in ${days}d`;
  }
  if (hrs > 0) return `Expires in ${hrs}h ${mins}m`;
  return `Expires in ${mins}m`;
}

function isExpiringSoon(expiresAt: string): boolean {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  return remaining > 0 && remaining < 6 * 3_600_000; // < 6 hours
}

function contactTypeLabel(type: ContactType): string {
  switch (type) {
    case 'call':          return '📞 Call request';
    case 'message':       return '💬 Message';
    case 'slot_booking':  return '📅 Slot booking';
  }
}

function tierColor(tier: TrustTier): string {
  switch (tier) {
    case 'highly_trusted': return COLORS.verdigris;
    case 'trusted':        return COLORS.ltVerdigris;
    case 'basic':          return COLORS.saffron;
    default:               return COLORS.grey;
  }
}

function tierShortLabel(tier: TrustTier): string {
  switch (tier) {
    case 'highly_trusted': return 'HT';
    case 'trusted':        return 'T';
    case 'basic':          return 'B';
    default:               return 'U';
  }
}

// ─── Consumer Trust Badge ─────────────────────────────────────────────────────

function ConsumerTrustBadge({ tier }: { tier: TrustTier }) {
  return (
    <View style={[
      styles.badge,
      { backgroundColor: tierColor(tier) + '22', borderColor: tierColor(tier) },
    ]}>
      <Text style={[styles.badgeText, { color: tierColor(tier) }]}>
        {tierShortLabel(tier)}
      </Text>
    </View>
  );
}

// ─── Monthly Counter ──────────────────────────────────────────────────────────

function MonthlyCounter({ usage }: { usage: MonthlyUsage }) {
  const pct = usage.allocated > 0
    ? Math.min((usage.received / usage.allocated) * 100, 100)
    : 0;

  const isNearLimit = pct >= 80;

  return (
    <View style={styles.monthlyCard}>
      <View style={styles.monthlyHeader}>
        <Text style={styles.monthlyTitle}>This month</Text>
        <Text style={[
          styles.monthlyCount,
          { color: isNearLimit ? COLORS.terracotta : COLORS.deepInk },
        ]}>
          {usage.received} / {usage.allocated} leads
        </Text>
      </View>
      <View style={styles.monthlyBarTrack}>
        <View
          style={[
            styles.monthlyBarFill,
            {
              width: `${pct}%` as any,
              backgroundColor: isNearLimit ? COLORS.terracotta : COLORS.verdigris,
            },
          ]}
        />
      </View>
      <Text style={styles.monthlySubtext}>
        {usage.accepted} accepted · {usage.declined} declined
      </Text>
    </View>
  );
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

interface LeadCardProps {
  lead:      Lead;
  onAccept:  (id: string) => void;
  onDecline: (lead: Lead) => void;
  onDefer:   (id: string) => void;
  loading:   boolean;
}

function LeadCard({ lead, onAccept, onDecline, onDefer, loading }: LeadCardProps) {
  const isExpired  = lead.status === 'expired';
  const isPending  = lead.status === 'pending';
  const expireSoon = isPending && isExpiringSoon(lead.expiresAt);
  const countdown  = isPending ? expiryCountdown(lead.expiresAt) : null;

  return (
    <View style={[styles.leadCard, isExpired && styles.leadCardExpired]}>
      {/* Top row */}
      <View style={styles.leadCardTop}>
        <View style={styles.leadConsumer}>
          <ConsumerTrustBadge tier={lead.consumer.trustTier} />
          <View style={styles.leadConsumerText}>
            <Text style={styles.leadConsumerName}>{lead.consumer.displayName}</Text>
            <Text style={styles.leadContactType}>
              {contactTypeLabel(lead.contactType)}
            </Text>
          </View>
        </View>
        <Text style={styles.leadTimeAgo}>{timeAgo(lead.createdAt)}</Text>
      </View>

      {/* Area hint */}
      {null /* area_hint not in schema */ && (
        <Text style={styles.leadAreaHint}>📍 {null /* area_hint not in schema */}</Text>
      )}

      {/* Message preview */}
      {null /* message_preview not in schema */ && (
        <Text style={styles.leadMessagePreview} numberOfLines={2}>
          "{null /* message_preview not in schema */}"
        </Text>
      )}

      {/* Expiry countdown */}
      {isPending && countdown && (
        <View style={[
          styles.expiryRow,
          expireSoon && styles.expiryRowUrgent,
        ]}>
          <Text style={[
            styles.expiryText,
            { color: expireSoon ? COLORS.terracotta : COLORS.grey },
          ]}>
            ⏱ {countdown}
          </Text>
          {expireSoon && (
            <Text style={styles.expiryUrgentNote}>
              Respond to protect your Response Rate
            </Text>
          )}
        </View>
      )}

      {/* Status badge for non-pending */}
      {!isPending && (
        <View style={[
          styles.statusBadge,
          {
            backgroundColor:
              lead.status === 'accepted'
                ? COLORS.verdigris + '22'
                : lead.status === 'declined'
                ? COLORS.terracotta + '18'
                : COLORS.grey + '18',
          },
        ]}>
          <Text style={[
            styles.statusBadgeText,
            {
              color:
                lead.status === 'accepted'
                  ? COLORS.verdigris
                  : lead.status === 'declined'
                  ? COLORS.terracotta
                  : COLORS.grey,
            },
          ]}>
            {lead.status.charAt(0).toUpperCase() + lead.status.slice(1)}
          </Text>
        </View>
      )}

      {/* Actions — only for pending */}
      {isPending && (
        <View style={styles.leadActions}>
          {/* Accept */}
          <TouchableOpacity
            style={[styles.acceptBtn, loading && styles.btnDisabled]}
            onPress={() => onAccept(lead.id)}
            disabled={loading}
          >
            <Text style={styles.acceptBtnText}>Accept</Text>
          </TouchableOpacity>

          {/* Decline */}
          <TouchableOpacity
            style={[styles.declineBtn, loading && styles.btnDisabled]}
            onPress={() => onDecline(lead)}
            disabled={loading}
          >
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>

          {/* Defer */}
          <TouchableOpacity
            style={styles.deferBtn}
            onPress={() => onDefer(lead.id)}
            disabled={loading}
          >
            <Text style={styles.deferBtnText}>Defer</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Decline Bottom Sheet ─────────────────────────────────────────────────────

interface DeclineSheetProps {
  visible:   boolean;
  lead:      Lead | null;
  onConfirm: (leadId: string, reason: DeclineReasonId) => void;
  onCancel:  () => void;
}

function DeclineSheet({ visible, lead, onConfirm, onCancel }: DeclineSheetProps) {
  const [selected, setSelected] = useState<DeclineReasonId | null>(null);
  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    if (visible) {
      setSelected(null);
      Animated.spring(slideAnim, {
        toValue:         0,
        useNativeDriver: true,
        bounciness:      4,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue:         300,
        duration:        200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  if (!lead) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.sheetOverlay} onPress={onCancel}>
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          <Pressable /* block touches from overlay */>
            {/* Handle */}
            <View style={styles.sheetHandle} />

            <Text style={styles.sheetTitle}>Why are you declining?</Text>
            <Text style={styles.sheetSubtitle}>
              Responding honestly keeps your Response Rate healthy.
            </Text>

            {/* Response Rate note */}
            <View style={styles.sheetRateNote}>
              <Text style={styles.sheetRateNoteText}>
                ⚠️ Letting leads expire without responding hurts your{' '}
                <Text style={{ fontFamily: 'PlusJakartaSans-SemiBold' }}>
                  Response Rate
                </Text>{' '}
                signal. Declining is always better than ignoring.
              </Text>
            </View>

            {/* Reason options */}
            {DECLINE_REASONS.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[
                  styles.reasonRow,
                  selected === r.id && styles.reasonRowSelected,
                ]}
                onPress={() => setSelected(r.id)}
              >
                <View style={[
                  styles.reasonRadio,
                  selected === r.id && styles.reasonRadioSelected,
                ]}>
                  {selected === r.id && (
                    <View style={styles.reasonRadioDot} />
                  )}
                </View>
                <Text style={[
                  styles.reasonLabel,
                  selected === r.id && styles.reasonLabelSelected,
                ]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Confirm */}
            <TouchableOpacity
              style={[
                styles.confirmDeclineBtn,
                !selected && styles.btnDisabled,
              ]}
              onPress={() =>
                selected && lead && onConfirm(lead.id, selected)
              }
              disabled={!selected}
            >
              <Text style={styles.confirmDeclineBtnText}>
                Decline lead
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelSheetBtn}
              onPress={onCancel}
            >
              <Text style={styles.cancelSheetBtnText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LeadsScreen() {
  const navigation = useNavigation<any>();

  const [leads,         setLeads]         = useState<Lead[]>([]);
  const [monthlyUsage,  setMonthlyUsage]  = useState<MonthlyUsage>({
    allocated: 20, received: 0, accepted: 0, declined: 0,
  });
  const [filter,        setFilter]        = useState<LeadStatus>('all');
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [page,          setPage]          = useState(1);
  const [hasMore,       setHasMore]       = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Decline sheet
  const [showDecline,   setShowDecline]   = useState(false);
  const [selectedLead,  setSelectedLead]  = useState<Lead | null>(null);

  // ── Fetch Leads ─────────────────────────────────────────────────────────────
  const loadLeads = useCallback(async (reset = false) => {
    const currentPage = reset ? 1 : page;
    if (!reset) setLoading(true);

    try {
      const resp = await getLeads({
        status: filter === 'all' ? undefined : filter,
        page:   currentPage,
        limit:  15,
      });

      const { data, meta, monthly_usage } = resp;

      setLeads(prev => reset ? data : [...prev, ...data]);
      setMonthlyUsage(monthly_usage);
      setHasMore(currentPage < meta.pages);

      if (reset) {
        setPage(1);
      } else {
        setPage(p => p + 1);
      }
    } catch (err) {
      console.error('[LeadsScreen] loadLeads', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, page]);

  // Reset on filter change
  useEffect(() => {
    setPage(1);
    setHasMore(true);
    loadLeads(true);
  }, [filter]);  // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadLeads(true);
  }, [loadLeads]);

  const onEndReached = useCallback(() => {
    if (!loading && hasMore) loadLeads(false);
  }, [loading, hasMore, loadLeads]);

  // ── Lead Actions ─────────────────────────────────────────────────────────────
  const handleAccept = useCallback(async (leadId: string) => {
    setActionLoading(leadId);
    try {
      await updateLead(leadId, { action: 'accept' });
      setLeads(prev =>
        prev.map(l => l.id === leadId ? { ...l, status: 'accepted' } : l),
      );
    } catch {
      /* error toast */
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleDeclinePress = useCallback((lead: Lead) => {
    setSelectedLead(lead);
    setShowDecline(true);
  }, []);

  const handleDeclineConfirm = useCallback(
    async (leadId: string, reason: DeclineReasonId) => {
      setShowDecline(false);
      setActionLoading(leadId);
      try {
        await updateLead(leadId, { action: 'decline', decline_reason: reason });
        setLeads(prev =>
          prev.map(l => l.id === leadId ? { ...l, status: 'declined' } : l),
        );
      } catch {
        /* error toast */
      } finally {
        setActionLoading(null);
        setSelectedLead(null);
      }
    },
    [],
  );

  const handleDefer = useCallback(async (leadId: string) => {
    setActionLoading(leadId);
    try {
      await updateLead(leadId, { action: 'defer' });
      // Deferred leads stay in 'pending' but timer resets by system_config defer_hours
    } catch {
      /* error toast */
    } finally {
      setActionLoading(null);
    }
  }, []);

  // ── Filtered count badge ──────────────────────────────────────────────────
  const pendingCount = leads.filter(l => l.status === 'pending').length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Leads</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('LeadFilterScreen')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.filterIcon}>⊞</Text>
        </TouchableOpacity>
      </View>

      {/* Monthly Counter */}
      <MonthlyCounter usage={monthlyUsage} />

      {/* Filter Tabs */}
      <View style={styles.tabsRow}>
        {FILTER_TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tab,
              filter === tab.key && styles.tabActive,
            ]}
            onPress={() => setFilter(tab.key)}
          >
            <Text style={[
              styles.tabText,
              filter === tab.key && styles.tabTextActive,
            ]}>
              {tab.label}
              {tab.key === 'pending' && pendingCount > 0
                ? ` (${pendingCount})`
                : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Leads List */}
      {loading && leads.length === 0 ? (
        <ActivityIndicator
          style={{ marginTop: 40 }}
          size="large"
          color={COLORS.saffron}
        />
      ) : (
        <FlatList
          data={leads}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <LeadCard
              lead={item}
              onAccept={handleAccept}
              onDecline={handleDeclinePress}
              onDefer={handleDefer}
              loading={actionLoading === item.id}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📭</Text>
              <Text style={styles.emptyTitle}>No leads here</Text>
              <Text style={styles.emptySubtitle}>
                {filter === 'pending'
                  ? 'You have no pending leads right now.'
                  : `No ${filter} leads to show.`}
              </Text>
            </View>
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.saffron}
            />
          }
          ListFooterComponent={
            hasMore && leads.length > 0 ? (
              <ActivityIndicator
                style={{ marginVertical: 16 }}
                color={COLORS.saffron}
              />
            ) : null
          }
        />
      )}

      {/* Decline Bottom Sheet */}
      <DeclineSheet
        visible={showDecline}
        lead={selectedLead}
        onConfirm={handleDeclineConfirm}
        onCancel={() => {
          setShowDecline(false);
          setSelectedLead(null);
        }}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: COLORS.ivory,
  },

  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingHorizontal: 16,
    paddingTop:     12,
    paddingBottom:  8,
  },
  headerTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   22,
    color:      COLORS.deepInk,
  },
  filterIcon: {
    fontSize: 24,
    color:    COLORS.deepInk,
  },

  // Monthly Counter
  monthlyCard: {
    marginHorizontal: 16,
    marginBottom:     12,
    backgroundColor:  COLORS.white,
    borderRadius:     12,
    padding:          14,
    shadowColor:      '#1C1C2E',
    shadowOffset:     { width: 0, height: 1 },
    shadowOpacity:    0.06,
    shadowRadius:     4,
    elevation:        1,
  },
  monthlyHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'baseline',
    marginBottom:   8,
  },
  monthlyTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      COLORS.deepInk,
  },
  monthlyCount: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   14,
  },
  monthlyBarTrack: {
    height:          7,
    borderRadius:    4,
    backgroundColor: COLORS.border,
    overflow:        'hidden',
    marginBottom:    6,
  },
  monthlyBarFill: {
    height:       7,
    borderRadius: 4,
  },
  monthlySubtext: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      COLORS.grey,
  },

  // Filter Tabs
  tabsRow: {
    flexDirection:    'row',
    paddingHorizontal: 16,
    marginBottom:     8,
  },
  tab: {
    flex:            1,
    paddingVertical:  7,
    alignItems:      'center',
    borderRadius:    8,
    marginHorizontal: 2,
  },
  tabActive: {
    backgroundColor: COLORS.deepInk,
  },
  tabText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    color:      COLORS.grey,
  },
  tabTextActive: {
    color: COLORS.ivory,
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom:     100,
    flexGrow: 1,
  },

  // Lead Card
  leadCard: {
    backgroundColor: COLORS.white,
    borderRadius:    14,
    padding:         14,
    marginBottom:    10,
    shadowColor:     '#1C1C2E',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.06,
    shadowRadius:    5,
    elevation:       1,
  },
  leadCardExpired: {
    opacity: 0.65,
  },
  leadCardTop: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    marginBottom:   6,
  },
  leadConsumer: {
    flexDirection: 'row',
    alignItems:    'center',
    flex:          1,
  },
  badge: {
    width:        28,
    height:       28,
    borderRadius: 14,
    borderWidth:  1.5,
    justifyContent: 'center',
    alignItems:     'center',
    marginRight:    10,
  },
  badgeText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   11,
  },
  leadConsumerText: {
    flex: 1,
  },
  leadConsumerName: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      COLORS.deepInk,
  },
  leadContactType: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginTop:  2,
  },
  leadTimeAgo: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
  },
  leadAreaHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginBottom: 4,
  },
  leadMessagePreview: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      COLORS.deepInk,
    fontStyle:  'italic',
    marginBottom: 6,
    lineHeight: 18,
  },

  // Expiry
  expiryRow: {
    flexDirection: 'row',
    alignItems:    'center',
    flexWrap:      'wrap',
    gap:           6,
    marginBottom:  8,
  },
  expiryRowUrgent: {
    backgroundColor: '#FFF4F4',
    borderRadius:    6,
    padding:         6,
  },
  expiryText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
  },
  expiryUrgentNote: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      COLORS.terracotta,
  },

  // Status badge
  statusBadge: {
    alignSelf:    'flex-start',
    paddingHorizontal: 10,
    paddingVertical:    4,
    borderRadius:  6,
    marginTop:     4,
  },
  statusBadgeText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
  },

  // Actions
  leadActions: {
    flexDirection: 'row',
    alignItems:    'center',
    marginTop:     10,
    gap:           8,
  },
  acceptBtn: {
    flex:              1,
    backgroundColor:   COLORS.verdigris,
    borderRadius:      10,
    paddingVertical:    10,
    alignItems:        'center',
  },
  acceptBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   14,
    color:      COLORS.white,
  },
  declineBtn: {
    flex:          1,
    borderRadius:  10,
    paddingVertical: 10,
    alignItems:    'center',
    borderWidth:   1.5,
    borderColor:   COLORS.deepInk,
  },
  declineBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   14,
    color:      COLORS.deepInk,
  },
  deferBtn: {
    paddingHorizontal: 8,
    paddingVertical:   10,
    alignItems:        'center',
  },
  deferBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      COLORS.grey,
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // Decline Sheet
  sheetOverlay: {
    flex:            1,
    backgroundColor: 'rgba(28,28,46,0.5)',
    justifyContent:  'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    paddingHorizontal:    20,
    paddingBottom:        40,
    paddingTop:           12,
  },
  sheetHandle: {
    width:           40,
    height:           4,
    borderRadius:     2,
    backgroundColor: COLORS.border,
    alignSelf:       'center',
    marginBottom:    16,
  },
  sheetTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   18,
    color:      COLORS.deepInk,
    marginBottom: 4,
  },
  sheetSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      COLORS.grey,
    marginBottom: 12,
  },
  sheetRateNote: {
    backgroundColor: '#FFF9F0',
    borderRadius:    10,
    padding:         12,
    marginBottom:    16,
    borderWidth:     1,
    borderColor:     COLORS.warmSand,
  },
  sheetRateNoteText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      COLORS.deepInk,
    lineHeight: 18,
  },
  reasonRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  reasonRowSelected: {
    backgroundColor: COLORS.bgLight,
    borderRadius:    8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  reasonRadio: {
    width:        22,
    height:       22,
    borderRadius: 11,
    borderWidth:  2,
    borderColor:  COLORS.border,
    justifyContent: 'center',
    alignItems:     'center',
    marginRight:    12,
  },
  reasonRadioSelected: {
    borderColor: COLORS.verdigris,
  },
  reasonRadioDot: {
    width:           10,
    height:          10,
    borderRadius:    5,
    backgroundColor: COLORS.verdigris,
  },
  reasonLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   15,
    color:      COLORS.deepInk,
  },
  reasonLabelSelected: {
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  confirmDeclineBtn: {
    backgroundColor: COLORS.terracotta,
    borderRadius:    12,
    paddingVertical:  14,
    alignItems:      'center',
    marginTop:       20,
  },
  confirmDeclineBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   15,
    color:      COLORS.white,
  },
  cancelSheetBtn: {
    paddingVertical: 12,
    alignItems:      'center',
    marginTop:        4,
  },
  cancelSheetBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      COLORS.grey,
  },

  // Empty state
  emptyState: {
    alignItems:  'center',
    marginTop:    60,
    paddingHorizontal: 40,
  },
  emptyEmoji: { fontSize: 44, marginBottom: 12 },
  emptyTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   18,
    color:      COLORS.deepInk,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   14,
    color:      COLORS.grey,
    textAlign:  'center',
    lineHeight: 20,
  },
});
