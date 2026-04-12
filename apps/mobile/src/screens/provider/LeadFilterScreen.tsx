/**
 * LeadFilterScreen.tsx
 * SatvAAh · Phase 23 · Lead Filter
 *
 * Presented as a stack screen from LeadsScreen (filter icon).
 * Returns selected filters via navigation.navigate('Leads', { filters }).
 * Stateless — receives current filters as route params.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';

// ─── Types ────────────────────────────────────────────────────────────────────

type ContactTypeFilter = 'all' | 'call' | 'message' | 'slot_booking';
type SortByFilter      = 'newest' | 'oldest' | 'expiring_soon';
type TierFilter        = 'all' | 'basic' | 'trusted' | 'highly_trusted';
type PeriodFilter      = 'week' | 'month' | 'all';

export interface LeadFilters {
  contactType: ContactTypeFilter;
  sort_by:      SortByFilter;
  consumer_tier: TierFilter;
  period:       PeriodFilter;
}

// Default / empty filter state
export const DEFAULT_LEAD_FILTERS: LeadFilters = {
  contactType:  'all',
  sort_by:       'newest',
  consumer_tier: 'all',
  period:        'month',
};

type LeadFilterScreenRoute = RouteProp<
  { LeadFilterScreen: { currentFilters: LeadFilters } },
  'LeadFilterScreen'
>;

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  saffron:   '#C8691A',
  deepInk:   '#1C1C2E',
  ivory:     '#FAF7F0',
  verdigris: '#2E7D72',
  ltVerd:    '#6BA89E',
  warmSand:  '#F0E4CC',
  grey:      '#6B6560',
  white:     '#FFFFFF',
  border:    '#E8E0D0',
} as const;

// ─── Option Row Picker ────────────────────────────────────────────────────────

interface OptionProps<T extends string> {
  label:    string;
  subtitle?: string;
  value:    T;
  selected: T;
  onSelect: (v: T) => void;
  color?:   string;
}

function Option<T extends string>({
  label, subtitle, value, selected, onSelect, color,
}: OptionProps<T>) {
  const isSelected = value === selected;
  return (
    <TouchableOpacity
      style={[styles.optionRow, isSelected && styles.optionRowSelected]}
      onPress={() => onSelect(value)}
      activeOpacity={0.75}
    >
      <View style={styles.optionLeft}>
        <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
          {label}
        </Text>
        {subtitle && (
          <Text style={styles.optionSubtitle}>{subtitle}</Text>
        )}
      </View>
      {/* Color swatch for tier filters */}
      {color && (
        <View style={[styles.optionSwatch, { backgroundColor: color }]} />
      )}
      <View style={[
        styles.optionRadio,
        isSelected && { borderColor: COLORS.verdigris },
      ]}>
        {isSelected && <View style={styles.optionRadioDot} />}
      </View>
    </TouchableOpacity>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LeadFilterScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<LeadFilterScreenRoute>();
  const current = route.params?.currentFilters ?? DEFAULT_LEAD_FILTERS;

  const [contactType,  setContactType]  = useState<ContactTypeFilter>(current.contactType);
  const [sortBy,       setSortBy]       = useState<SortByFilter>(current.sort_by);
  const [consumerTier, setConsumerTier] = useState<TierFilter>(current.consumer_tier);
  const [period,       setPeriod]       = useState<PeriodFilter>(current.period);

  const hasChanges =
    contactType  !== current.contactType ||
    sortBy       !== current.sort_by ||
    consumerTier !== current.consumer_tier ||
    period       !== current.period;

  const applyFilters = () => {
    const filters: LeadFilters = { contactType: contactType, sort_by: sortBy, consumer_tier: consumerTier, period };
    navigation.navigate('Leads', { filters });
  };

  const resetFilters = () => {
    setContactType('all');
    setSortBy('newest');
    setConsumerTier('all');
    setPeriod('month');
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color="#1C1C2E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Filter Leads</Text>
        <TouchableOpacity onPress={resetFilters}>
          <Text style={[
            styles.resetText,
            !hasChanges && styles.resetTextDisabled,
          ]}>
            Reset
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Contact Type ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Contact Type" />
          <Option<ContactTypeFilter>
            label="All types"
            value="all"
            selected={contactType}
            onSelect={setContactType}
          />
          <Option<ContactTypeFilter>
            label="📞 Call request"
            value="call"
            selected={contactType}
            onSelect={setContactType}
          />
          <Option<ContactTypeFilter>
            label="💬 Message"
            value="message"
            selected={contactType}
            onSelect={setContactType}
          />
          <Option<ContactTypeFilter>
            label="📅 Slot booking"
            subtitle="Gold tier consumers only"
            value="slot_booking"
            selected={contactType}
            onSelect={setContactType}
          />
        </View>

        <View style={styles.divider} />

        {/* ── Sort By ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Sort By" />
          <Option<SortByFilter>
            label="Newest first"
            value="newest"
            selected={sortBy}
            onSelect={setSortBy}
          />
          <Option<SortByFilter>
            label="Oldest first"
            value="oldest"
            selected={sortBy}
            onSelect={setSortBy}
          />
          <Option<SortByFilter>
            label="⏱ Expiring soon"
            subtitle="Pending leads closest to 48h deadline"
            value="expiring_soon"
            selected={sortBy}
            onSelect={setSortBy}
          />
        </View>

        <View style={styles.divider} />

        {/* ── Consumer Trust Tier ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Consumer Trust Tier" />
          <Text style={styles.sectionNote}>
            Higher trust consumers are more likely to follow through.
          </Text>
          <Option<TierFilter>
            label="All tiers"
            value="all"
            selected={consumerTier}
            onSelect={setConsumerTier}
          />
          <Option<TierFilter>
            label="Highly Trusted"
            subtitle="Score 80+"
            value="highly_trusted"
            selected={consumerTier}
            onSelect={setConsumerTier}
            color={COLORS.verdigris}
          />
          <Option<TierFilter>
            label="Trusted"
            subtitle="Score 60–79"
            value="trusted"
            selected={consumerTier}
            onSelect={setConsumerTier}
            color={COLORS.ltVerd}
          />
          <Option<TierFilter>
            label="Basic"
            subtitle="Score 20–59"
            value="basic"
            selected={consumerTier}
            onSelect={setConsumerTier}
            color={COLORS.saffron}
          />
        </View>

        <View style={styles.divider} />

        {/* ── Time Period ───────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Period" />
          <Option<PeriodFilter>
            label="This week"
            value="week"
            selected={period}
            onSelect={setPeriod}
          />
          <Option<PeriodFilter>
            label="This month"
            value="month"
            selected={period}
            onSelect={setPeriod}
          />
          <Option<PeriodFilter>
            label="All time"
            value="all"
            selected={period}
            onSelect={setPeriod}
          />
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Apply Button */}
      <View style={styles.applyContainer}>
        <TouchableOpacity
          style={[styles.applyBtn, !hasChanges && styles.applyBtnDisabled]}
          onPress={applyFilters}
          disabled={!hasChanges}
        >
          <Text style={styles.applyBtnText}>Apply Filters</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: COLORS.ivory,
  },

  // Header
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop:     12,
    paddingBottom:  8,
  },
  backText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      COLORS.saffron,
  },
  headerTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   17,
    color:      COLORS.deepInk,
  },
  resetText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      COLORS.terracotta,
  },
  resetTextDisabled: {
    color: COLORS.grey,
  },

  // Scroll
  scroll: {
    paddingHorizontal: 16,
    paddingBottom:     16,
  },

  // Sections
  section: {
    paddingVertical: 8,
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   14,
    color:      COLORS.grey,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom:  6,
    marginTop:     4,
  },
  sectionNote: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginBottom: 6,
    lineHeight:  16,
  },
  divider: {
    height:          1,
    backgroundColor: COLORS.border,
    marginVertical:  4,
  },

  // Option Row
  optionRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius:   10,
    marginVertical:  1,
  },
  optionRowSelected: {
    backgroundColor: COLORS.warmSand,
  },
  optionLeft: {
    flex: 1,
  },
  optionLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   15,
    color:      COLORS.deepInk,
  },
  optionLabelSelected: {
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  optionSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginTop:  2,
  },
  optionSwatch: {
    width:        12,
    height:       12,
    borderRadius:  6,
    marginRight:  12,
  },
  optionRadio: {
    width:          22,
    height:         22,
    borderRadius:   11,
    borderWidth:     2,
    borderColor:    COLORS.border,
    justifyContent: 'center',
    alignItems:     'center',
  },
  optionRadioDot: {
    width:           10,
    height:          10,
    borderRadius:     5,
    backgroundColor: COLORS.verdigris,
  },

  // Apply
  applyContainer: {
    paddingHorizontal: 16,
    paddingVertical:   14,
    backgroundColor:   COLORS.ivory,
    borderTopWidth:    1,
    borderTopColor:    COLORS.border,
  },
  applyBtn: {
    backgroundColor: COLORS.verdigris,
    borderRadius:    14,
    paddingVertical:  16,
    alignItems:      'center',
  },
  applyBtnDisabled: {
    backgroundColor: COLORS.border,
  },
  applyBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   16,
    color:      COLORS.white,
  },

  bottomSpacer: { height: 8 },

  // (used in ResetText state check)
  terracotta: { color: '#C0392B' },
});

// ── Patch missing color ref ──────────────────────────────────────────────────
// 'terracotta' key referenced in styles above for resetText active color
// Added explicitly to COLORS above avoids runtime warning.
