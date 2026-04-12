/**
 * ConsumerProfileScreen.tsx
 * SatvAAh — Phase 21
 *
 * Sections:
 *   1. Avatar (initials fallback) + subscription badge
 *   2. Lead counter with progress bar (leads_used / leads_allocated)
 *   3. Trusted Circle — shown only when accepted contact count >= 3
 *   4. Referral code + Share button
 *   5. Contact history — last 20 contact_events
 *   6. Settings: notification prefs, Switch to Provider Mode, DPDP, Logout
 *
 * Endpoints:
 *   GET  /api/v1/consumers/me           (user :3002)
 *   GET  /api/v1/subscriptions/me       (payment :3007)
 *   GET  /api/v1/consumers/me/contacts  (user :3002) — last 20
 *   PATCH /api/v1/users/me/mode         (user :3002) — switch mode
 *   POST /api/v1/auth/logout            (auth :3001)
 */

import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 ActivityIndicator,
 Alert,
 RefreshControl,
 ScrollView,
 Share,
 StyleSheet,
 Text,
 TouchableOpacity,
 View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../api/client';

// ─── Brand ───────────────────────────────────────────────────────────────────

const SAFFRON = '#C8691A';
const DEEP_INK = '#1C1C2E';
const IVORY = '#FAF7F0';
const VERDIGRIS = '#2E7D72';
const LIGHT_VERDIGRIS = '#6BA89E';
const WARM_SAND = '#F0E4CC';
const GREY = '#6B6560';
const BORDER = '#E8E0D0';

// ─── Types ───────────────────────────────────────────────────────────────────

type SubscriptionTier = 'free' | 'silver' | 'gold';

interface ConsumerProfile {
  userId: string;
  displayName: string;
  phone: string;
  cityLabel: string;
  subscriptionTier: SubscriptionTier;
  referralCode: string;
  trustScore: number;
  trustTier: string;
  notificationPrefs: Record<string, boolean>;
}

interface LeadUsage {
  leadsUsed: number;
  leadsAllocated: number;
  periodEnd: string; // ISO UTC
}

interface ContactHistoryItem {
  id: string;
  providerId: string;
  providerDisplayName: string;
  provider_primary_taxonomy: string;
  contactType: 'call' | 'message' | 'slot_booking';
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string; // ISO UTC
}

interface TrustedCircleMember {
  providerId: string;
  displayName: string;
  primaryTaxonomy: string;
  trustTier: string;
  trustScore: number;
  contactCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function tierBadgeColour(tier: SubscriptionTier): { bg: string; text: string; label: string } {
  const map: Record<SubscriptionTier, { bg: string; text: string; label: string }> = {
    free:   { bg: WARM_SAND,  text: DEEP_INK, label: 'Free' },
    silver: { bg: '#E8E0D0',  text: '#555',   label: 'Silver' },
    gold:   { bg: '#F5C842',  text: '#3A2800', label: 'Gold ✦' },
  };
  return map[tier];
}

function formatContactDate(isoUtc: string): string {
  return new Date(isoUtc).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function contactStatusColour(status: ContactHistoryItem['status']): string {
  const map: Record<ContactHistoryItem['status'], string> = {
    accepted: VERDIGRIS,
    pending: SAFFRON,
    declined: '#B00020',
    expired: GREY,
  };
  return map[status];
}

function contactTypeIcon(type: ContactHistoryItem['contact_type']): keyof typeof Ionicons.glyphMap {
  const map: Record<ContactHistoryItem['contact_type'], keyof typeof Ionicons.glyphMap> = {
    call: 'call-outline',
    message: 'chatbubble-outline',
    slot_booking: 'calendar-outline',
  };
  return map[type];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AvatarBlock({
  profile,
  leadUsage,
}: {
  profile: ConsumerProfile;
  leadUsage: LeadUsage | null;
}) {
  const badge = tierBadgeColour(profile.subscriptionTier);
  const progress =
    leadUsage && leadUsage.leadsAllocated > 0
      ? Math.min(leadUsage.leadsUsed / leadUsage.leadsAllocated, 1)
      : 0;
  const periodEndLabel = leadUsage
    ? new Date(leadUsage.periodEnd).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Kolkata',
      })
    : '';

  return (
        <View style={styles.avatarBlock}>
      {/* Avatar */}
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarInitials}>{initials(profile.displayName)}</Text>
      </View>

      {/* Name + Badge */}
      <View style={styles.avatarMeta}>
        <View style={styles.nameRow}>
          <Text style={styles.displayName}>{profile.displayName}</Text>
          <View style={[styles.tierBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.tierBadgeText, { color: badge.text }]}>{badge.label}</Text>
          </View>
        </View>
        <Text style={styles.cityLabel}>{profile.cityLabel}</Text>
      </View>

      {/* Lead counter */}
      {leadUsage !== null && (
        <View style={styles.leadBlock}>
          <View style={styles.leadRow}>
            <Text style={styles.leadLabel}>Leads this period</Text>
            <Text style={styles.leadCount}>
              {leadUsage.leadsUsed} / {leadUsage.leadsAllocated}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
          </View>
          {leadUsage.leadsAllocated > 0 && (
            <Text style={styles.leadExpiry}>Resets {periodEndLabel}</Text>
          )}
        </View>
      )}
    </View>
  );
}

function TrustedCircle({ members }: { members: TrustedCircleMember[] }) {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Trusted Circle</Text>
      <Text style={styles.sectionSubtitle}>
        Providers you've had {members.length}+ accepted contacts with
      </Text>
      {members.map((m) => (
        <TouchableOpacity
          key={m.providerId}
          style={styles.trustedRow}
          onPress={() =>
            navigation.navigate('ProviderProfile', { providerId: m.providerId })
          }
        >
          <View style={styles.trustedAvatar}>
            <Text style={styles.trustedAvatarText}>{initials(m.displayName)}</Text>
          </View>
          <View style={styles.trustedMeta}>
            <Text style={styles.trustedName}>{m.displayName}</Text>
            <Text style={styles.trustedTax}>{m.primaryTaxonomy}</Text>
          </View>
          <View style={styles.trustedScoreBlock}>
            <Text style={styles.trustedScore}>{m.trustScore}</Text>
            <Text style={styles.trustedTier}>{m.trustTier.replace('_', ' ')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={GREY} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ReferralBlock({ code }: { code: string }) {
  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `Join SatvAAh — India's trust layer for the informal economy. Use my referral code ${code} to get started: https://satvaaah.com/join/${code}`,
        title: 'Join SatvAAh',
      });
    } catch {
      // Share dismissed — silent
    }
  }, [code]);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Referral Code</Text>
      <View style={styles.referralRow}>
        <View style={styles.referralCodeBox}>
          <Text style={styles.referralCode}>{code}</Text>
        </View>
        <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
          <Ionicons name="share-social-outline" size={16} color="#fff" />
          <Text style={styles.shareButtonText}>Share</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.referralHint}>
        Earn bonus leads when a new user joins with your code
      </Text>
    </View>
  );
}

function ContactHistoryList({ items }: { items: ContactHistoryItem[] }) {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Contact History</Text>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>No contacts yet.</Text>
      ) : (
        items.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.historyRow}
            onPress={() =>
              navigation.navigate('ProviderProfile', { providerId: item.providerId })
            }
          >
            <Ionicons name={contactTypeIcon(item.contactType)} size={18} color={GREY} />
            <View style={styles.historyMeta}>
              <Text style={styles.historyName}>{item.providerDisplayName}</Text>
              <Text style={styles.historyTax}>{item.provider_primary_taxonomy}</Text>
            </View>
            <View style={styles.historyRight}>
              <Text style={[styles.historyStatus, { color: contactStatusColour(item.status) }]}>
                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              </Text>
              <Text style={styles.historyDate}>{formatContactDate(item.createdAt)}</Text>
            </View>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ConsumerProfileScreen() {
  const navigation = useNavigation<any>();

  const [profile, setProfile] = useState<ConsumerProfile | null>(null);
  const [leadUsage, setLeadUsage] = useState<LeadUsage | null>(null);
  const [contactHistory, setContactHistory] = useState<ContactHistoryItem[]>([]);
  const [trustedCircle, setTrustedCircle] = useState<TrustedCircleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);

  const loadData = useCallback(async () => {
    try {
      // Parallel fetches — consumer profile, subscription, contacts
      const [profileRes, subRes, contactsRes] = await Promise.all([
        apiClient.get<{ success: true; data: ConsumerProfile }>('/api/v1/consumers/me'),
        apiClient
          .get<{ success: true; data: LeadUsage }>('/api/v1/subscriptions/me')
          .catch(() => null),
        apiClient
          .get<{ success: true; data: ContactHistoryItem[] }>(
            '/api/v1/consumers/me/contacts?limit=20',
          )
          .catch(() => null),
      ]);

      setProfile(profileRes.data.data);
      if (subRes) setLeadUsage(subRes.data.data);

      const contacts = contactsRes?.data.data ?? [];
      setContactHistory(contacts);

      // Build Trusted Circle: providers with ≥3 accepted contacts
      const accepted = contacts.filter((c) => c.status === 'accepted');
      const countByProvider: Record<string, number> = {};
      for (const c of accepted) {
        countByProvider[c.providerId] = (countByProvider[c.providerId] ?? 0) + 1;
      }
      // Fetch live trust scores for providers with ≥3 contacts
      const trustedIds = Object.entries(countByProvider)
        .filter(([, count]) => count >= 3)
        .map(([id]) => id);

      if (trustedIds.length > 0) {
        // Fetch each provider individually — /api/v1/providers/:id exists and is public
        const providerResults = await Promise.all(
          trustedIds.map((id) =>
            apiClient
              .get<{ success: true; data: any }>(`/api/v1/providers/${id}`)
              .then((res) => {
                const p = res.data.data;
                return {
                  providerId:      p.id,
                  displayName:     p.displayName ?? p.display_name ?? '',
                  primaryTaxonomy: p.category ?? p.taxonomyNode?.display_name ?? '',
                  trustTier:       p.trust?.trustTier ?? p.trust?.trust_tier ?? 'unverified',
                  trustScore:      p.trust?.displayScore ?? p.trust?.display_score ?? 0,
                  contactCount:    countByProvider[id] ?? 0,
                } as TrustedCircleMember;
              })
              .catch(() => null),
          ),
        );
        setTrustedCircle(providerResults.filter(Boolean) as TrustedCircleMember[]);
      } else {
        setTrustedCircle([]);
      }
    } catch (err) {
      if ((err as any)?.response?.status !== 404) console.error('[ConsumerProfileScreen] loadData error', err);
    }
  }, []);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleSwitchToProviderMode = useCallback(async () => {
    Alert.alert(
      'Switch to Provider Mode',
      'You will be switched to your provider profile. Switch now?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          style: 'default',
          onPress: async () => {
            setSwitchingMode(true);
            try {
              await apiClient.patch('/api/v1/users/me/mode', { mode: 'provider' });
              // Navigation handled by auth store mode change listener
              navigation.reset({ index: 0, routes: [{ name: 'ProviderApp' }] });
            } catch {
              Alert.alert('Error', 'Could not switch modes. Please try again.');
            } finally {
              setSwitchingMode(false);
            }
          },
        },
      ],
    );
  }, [navigation]);

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.post('/api/v1/auth/logout');
          } finally {
            navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
          }
        },
      },
    ]);
  }, [navigation]);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={SAFFRON} size="large" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.loader}>
        <Text style={styles.errorText}>Could not load profile.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={SAFFRON} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Avatar + Lead counter */}
      <AvatarBlock profile={profile} leadUsage={leadUsage} />

      {/* Trust score quick link */}
      <TouchableOpacity
        style={styles.trustBanner}
        onPress={() => navigation.navigate('ConsumerTrust')}
      >
        <View style={styles.trustBannerLeft}>
          <Text style={styles.trustBannerScore}>{profile.trustScore}</Text>
          <View>
            <Text style={styles.trustBannerTitle}>Your Trust Score</Text>
            <Text style={styles.trustBannerSub}>
              {profile.trustTier.replace('_', ' ')} tier · Tap to view signals
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={VERDIGRIS} />
      </TouchableOpacity>

      {/* Trusted Circle — only visible after ≥3 accepted contacts */}
      {trustedCircle.length >= 1 && <TrustedCircle members={trustedCircle} />}

      {/* Referral code */}
      <ReferralBlock code={profile.referralCode} />

      {/* Contact history */}
      <ContactHistoryList items={contactHistory} />

      {/* Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Settings</Text>

        <SettingsRow
          icon="notifications-outline"
          label="Notification Preferences"
          onPress={() => navigation.navigate('NotificationSettings')}
        />
        <SettingsRow
          icon="bookmark-outline"
          label="Saved Providers"
          onPress={() => navigation.navigate('SavedProviders')}
        />
        <SettingsRow
          icon="briefcase-outline"
          label="Switch to Provider Mode"
          onPress={handleSwitchToProviderMode}
          loading={switchingMode}
          tint={SAFFRON}
        />
        <SettingsRow
          icon="shield-checkmark-outline"
          label="Privacy & Data Rights"
          onPress={() => navigation.navigate('DataRights')}
        />
        <SettingsRow
          icon="help-circle-outline"
          label="Help & Support"
          onPress={() => navigation.navigate('Support')}
        />
        <SettingsRow
          icon="log-out-outline"
          label="Log Out"
          onPress={handleLogout}
          tint="#B00020"
          noBorder
        />
      </View>

      <Text style={styles.footer}>SatvAAh Technologies · Truth that travels.</Text>
    </ScrollView>
  );
}

// ─── SettingsRow ──────────────────────────────────────────────────────────────

function SettingsRow({
  icon,
  label,
  onPress,
  tint,
  loading: rowLoading,
  noBorder,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tint?: string;
  loading?: boolean;
  noBorder?: boolean;
}) {
  return (
    
    
    <TouchableOpacity
      style={[styles.settingsRow, noBorder && { borderBottomWidth: 0 }]}
      onPress={onPress}
      disabled={rowLoading}
    >
      <Ionicons name={icon} size={20} color={tint ?? DEEP_INK} style={styles.settingsIcon} />
      <Text style={[styles.settingsLabel, tint ? { color: tint } : null]}>{label}</Text>
      {rowLoading ? (
        <ActivityIndicator size="small" color={SAFFRON} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={GREY} />
      )}
    </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: IVORY },
  scrollContent: { paddingBottom: 48 },
  loader: { flex: 1, backgroundColor: IVORY, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: GREY, fontSize: 15 },

  // Avatar block
  avatarBlock: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: SAFFRON,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarInitials: { color: '#fff', fontSize: 26, fontWeight: '700', fontFamily: 'Plus Jakarta Sans' },
  avatarMeta: { marginBottom: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  displayName: { fontSize: 20, fontWeight: '700', color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  tierBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  tierBadgeText: { fontSize: 11, fontWeight: '600', fontFamily: 'Plus Jakarta Sans' },
  cityLabel: { fontSize: 13, color: GREY, fontFamily: 'Plus Jakarta Sans' },

  // Lead counter
  leadBlock: { marginTop: 4 },
  leadRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  leadLabel: { fontSize: 13, color: GREY, fontFamily: 'Plus Jakarta Sans' },
  leadCount: { fontSize: 13, fontWeight: '600', color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  progressTrack: {
    height: 6,
    backgroundColor: WARM_SAND,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: SAFFRON, borderRadius: 3 },
  leadExpiry: { marginTop: 4, fontSize: 11, color: GREY, fontFamily: 'Plus Jakarta Sans' },

  // Trust banner
  trustBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    marginTop: 8,
  },
  trustBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  trustBannerScore: {
    fontSize: 32,
    fontWeight: '700',
    color: VERDIGRIS,
    fontFamily: 'Plus Jakarta Sans',
  },
  trustBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: DEEP_INK,
    fontFamily: 'Plus Jakarta Sans',
  },
  trustBannerSub: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans', marginTop: 2 },

  // Section
  section: {
    backgroundColor: '#fff',
    marginTop: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DEEP_INK,
    fontFamily: 'Plus Jakarta Sans',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: GREY,
    fontFamily: 'Plus Jakarta Sans',
    marginBottom: 12,
  },
  emptyText: { fontSize: 13, color: GREY, fontFamily: 'Plus Jakarta Sans', paddingVertical: 8 },

  // Trusted Circle
  trustedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 10,
  },
  trustedAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: WARM_SAND,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trustedAvatarText: { fontSize: 14, fontWeight: '600', color: DEEP_INK },
  trustedMeta: { flex: 1 },
  trustedName: { fontSize: 14, fontWeight: '600', color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  trustedTax: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans' },
  trustedScoreBlock: { alignItems: 'flex-end', marginRight: 4 },
  trustedScore: { fontSize: 16, fontWeight: '700', color: VERDIGRIS, fontFamily: 'Plus Jakarta Sans' },
  trustedTier: { fontSize: 10, color: GREY, textTransform: 'capitalize' },

  // Referral
  referralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    marginTop: 8,
  },
  referralCodeBox: {
    flex: 1,
    backgroundColor: WARM_SAND,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  referralCode: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
    color: DEEP_INK,
    fontFamily: 'Plus Jakarta Sans',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: SAFFRON,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  shareButtonText: { color: '#fff', fontSize: 14, fontWeight: '600', fontFamily: 'Plus Jakarta Sans' },
  referralHint: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans', marginBottom: 8 },

  // Contact history
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 10,
  },
  historyMeta: { flex: 1 },
  historyName: { fontSize: 14, fontWeight: '600', color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  historyTax: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans' },
  historyRight: { alignItems: 'flex-end' },
  historyStatus: { fontSize: 12, fontWeight: '600', fontFamily: 'Plus Jakarta Sans' },
  historyDate: { fontSize: 11, color: GREY, fontFamily: 'Plus Jakarta Sans', marginTop: 2 },

  // Settings
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  settingsIcon: { marginRight: 14 },
  settingsLabel: {
    flex: 1,
    fontSize: 15,
    color: DEEP_INK,
    fontFamily: 'Plus Jakarta Sans',
  },

  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: GREY,
    fontFamily: 'Plus Jakarta Sans',
    marginTop: 24,
    marginBottom: 8,
  },
});
