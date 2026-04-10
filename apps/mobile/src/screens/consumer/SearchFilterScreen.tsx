/**
 * apps/mobile/src/screens/consumer/SearchFilterScreen.tsx
 * SatvAAh Phase 18 — Search Filters
 *
 * Filters:
 *   • Trust score slider (0–100)
 *   • Distance (5 / 10 / 25 / 50 km)
 *   • Availability (available now toggle)
 *   • Home visit (toggle)
 *   • Languages (multi-select: English / Telugu / Hindi / Tamil / Kannada / Urdu)
 *   • Minimum rating (0–5 stars)
 *   • Sort order (Most Trusted / Nearest / Top Rated)
 *
 * Navigation: receives current filters from SearchResultsScreen,
 * returns new filters via navigation.navigate('SearchResults', { filters })
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import Slider from '@react-native-community/slider';

import type { Tab, SortOrder } from '../../api/search.api';

// ─── Navigation ────────────────────────────────────────────────────────────────

type FilterParams = {
  minTrust?: number;
  maxDistance?: number;
  availability?: boolean;
  homeVisit?: boolean;
  languages?: string;   // comma-separated BCP-47
  minRating?: number;
  sort: SortOrder;
};

type ConsumerStackParamList = {
  SearchResults: {
    query: string;
    taxonomyNodeId: string;
    tab: Tab;
    filters?: FilterParams;
  };
  SearchFilter: {
    filters: FilterParams;
    tab: Tab;
    query?: string;
    taxonomyNodeId?: string;
  };
};

type Nav   = NativeStackNavigationProp<ConsumerStackParamList>;
type Route = RouteProp<ConsumerStackParamList, 'SearchFilter'>;

// ─── Options ──────────────────────────────────────────────────────────────────

const DISTANCE_OPTIONS = [
  { label: '5 km',     value: 5   },
  { label: '10 km',    value: 10  },
  { label: '25 km',    value: 25  },
  { label: '50 km',    value: 50  },
  { label: 'Any',      value: undefined },
];

const LANGUAGE_OPTIONS = [
  { code: 'en-IN', label: 'English' },
  { code: 'te-IN', label: 'Telugu'  },
  { code: 'hi-IN', label: 'Hindi'   },
  { code: 'ta-IN', label: 'Tamil'   },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ur-IN', label: 'Urdu'    },
];

const SORT_OPTIONS: { key: SortOrder; label: string; description: string }[] = [
  { key: 'trust_score', label: 'Most Trusted',  description: 'Highest trust score first' },
  { key: 'distance',    label: 'Nearest First', description: 'Closest providers first'   },
  { key: 'rating',      label: 'Top Rated',     description: 'Highest customer ratings'  },
];

const RATING_OPTIONS = [0, 3, 3.5, 4, 4.5];

// ─── Sub-components ────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
}
const Section: React.FC<SectionProps> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

// ─── Main Screen ──────────────────────────────────────────────────────────────

const SearchFilterScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { filters: initialFilters } = route.params;

  // ── Local filter state (not applied until user taps Apply) ─────────────────
  const [minTrust, setMinTrust]       = useState(initialFilters.minTrust ?? 0);
  const [maxDistance, setMaxDistance] = useState<number | undefined>(
    initialFilters.maxDistance,
  );
  const [availability, setAvailability] = useState(
    initialFilters.availability ?? false,
  );
  const [homeVisit, setHomeVisit]     = useState(initialFilters.homeVisit ?? false);
  const [selectedLangs, setSelectedLangs] = useState<Set<string>>(
    () =>
      initialFilters.languages
        ? new Set(initialFilters.languages.split(',').filter(Boolean))
        : new Set(),
  );
  const [minRating, setMinRating]     = useState(initialFilters.minRating ?? 0);
  const [sort, setSort]               = useState<SortOrder>(
    initialFilters.sort ?? 'trust_score',
  );

  // ── Count active filters (for reset clarity) ──────────────────────────────
  const activeFilterCount = [
    minTrust > 0,
    maxDistance !== undefined,
    availability,
    homeVisit,
    selectedLangs.size > 0,
    minRating > 0,
    sort !== 'trust_score',
  ].filter(Boolean).length;

  // ── Language toggle ───────────────────────────────────────────────────────
  const toggleLang = useCallback((code: string) => {
    setSelectedLangs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  // ── Reset all filters ─────────────────────────────────────────────────────
  const resetFilters = useCallback(() => {
    setMinTrust(0);
    setMaxDistance(undefined);
    setAvailability(false);
    setHomeVisit(false);
    setSelectedLangs(new Set());
    setMinRating(0);
    setSort('trust_score');
  }, []);

  // ── Apply and go back ─────────────────────────────────────────────────────
  const applyFilters = useCallback(() => {
    const newFilters: FilterParams = {
      sort,
      ...(minTrust > 0 && { minTrust: minTrust }),
      ...(maxDistance !== undefined && { maxDistance: maxDistance }),
      ...(availability && { availability: true }),
      ...(homeVisit && { homeVisit: true }),
      ...(selectedLangs.size > 0 && { languages: Array.from(selectedLangs).join(',') }),
      ...(minRating > 0 && { minRating: minRating }),
    };
    // Navigate back with updated filters — SearchResultsScreen reads route.params.filters
    navigation.navigate('SearchResults', {
      query:          route.params.query ?? '',
      taxonomyNodeId: route.params.taxonomyNodeId ?? '',
      tab:            route.params.tab,
      filters:        newFilters,
    });
  }, [sort, minTrust, maxDistance, availability, homeVisit, selectedLangs, minRating, navigation, route.params]);

  // ── Trust score label ─────────────────────────────────────────────────────
  const trustLabel =
    minTrust === 0
      ? 'Any trust score'
      : minTrust < 20
        ? `≥ ${minTrust} (including unverified)`
        : minTrust < 60
          ? `≥ ${minTrust} — Basic+`
          : minTrust < 80
            ? `≥ ${minTrust} — Trusted+`
            : `≥ ${minTrust} — Highly Trusted only`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backIcon}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          Filters
          {activeFilterCount > 0 && (
            <Text style={styles.headerCount}> ({activeFilterCount})</Text>
          )}
        </Text>
        {activeFilterCount > 0 ? (
          <TouchableOpacity onPress={resetFilters} style={styles.resetBtn}>
            <Text style={styles.resetText}>Reset all</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 72 }} />
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Sort Order ── */}
        <Section title="Sort by">
          {SORT_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.sortRow, sort === opt.key && styles.sortRowActive]}
              onPress={() => setSort(opt.key)}
              activeOpacity={0.8}
            >
              <View style={styles.sortRowLeft}>
                <Text style={[
                  styles.sortRowLabel,
                  sort === opt.key && styles.sortRowLabelActive,
                ]}>
                  {opt.label}
                </Text>
                <Text style={styles.sortRowDesc}>{opt.description}</Text>
              </View>
              <View style={[styles.radioOuter, sort === opt.key && styles.radioOuterActive]}>
                {sort === opt.key && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          ))}
        </Section>

        {/* ── Trust Score Slider ── */}
        <Section title="Minimum trust score">
          <Text style={styles.sliderLabel}>{trustLabel}</Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            step={5}
            value={minTrust}
            onValueChange={setMinTrust}
            minimumTrackTintColor="#C8691A"
            maximumTrackTintColor="#E8E0D0"
            thumbTintColor="#C8691A"
            accessibilityLabel="Minimum trust score slider"
          />
          {/* Tier markers */}
          <View style={styles.sliderMarkers}>
            <Text style={styles.sliderMarkerText}>0</Text>
            <View style={styles.sliderMarkerLine}>
              <Text style={styles.sliderMarkerTick}>Basic</Text>
            </View>
            <View style={styles.sliderMarkerLine}>
              <Text style={styles.sliderMarkerTick}>Trusted</Text>
            </View>
            <View style={styles.sliderMarkerLine}>
              <Text style={styles.sliderMarkerTick}>Highly Trusted</Text>
            </View>
            <Text style={styles.sliderMarkerText}>100</Text>
          </View>
          {/* Visual tier strip */}
          <View style={styles.tierStrip}>
            <View style={[styles.tierSegment, { flex: 20, backgroundColor: '#6B6560' }]} />
            <View style={[styles.tierSegment, { flex: 40, backgroundColor: '#C8691A' }]} />
            <View style={[styles.tierSegment, { flex: 20, backgroundColor: '#6BA89E' }]} />
            <View style={[styles.tierSegment, { flex: 20, backgroundColor: '#2E7D72' }]} />
          </View>
        </Section>

        {/* ── Distance ── */}
        <Section title="Maximum distance">
          <View style={styles.chipRow}>
            {DISTANCE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={String(opt.value)}
                style={[
                  styles.chip,
                  maxDistance === opt.value && styles.chipActive,
                ]}
                onPress={() => setMaxDistance(opt.value)}
              >
                <Text style={[
                  styles.chipText,
                  maxDistance === opt.value && styles.chipTextActive,
                ]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        {/* ── Toggles ── */}
        <Section title="Availability">
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.toggleLabel}>Available now</Text>
              <Text style={styles.toggleSub}>Show only providers available at this moment</Text>
            </View>
            <Switch
              value={availability}
              onValueChange={setAvailability}
              trackColor={{ false: '#E8E0D0', true: '#C8691A' }}
              thumbColor="#FAF7F0"
              ios_backgroundColor="#E8E0D0"
            />
          </View>
          <View style={[styles.toggleRow, { marginTop: 12 }]}>
            <View>
              <Text style={styles.toggleLabel}>Home visit</Text>
              <Text style={styles.toggleSub}>Provider comes to your location</Text>
            </View>
            <Switch
              value={homeVisit}
              onValueChange={setHomeVisit}
              trackColor={{ false: '#E8E0D0', true: '#C8691A' }}
              thumbColor="#FAF7F0"
              ios_backgroundColor="#E8E0D0"
            />
          </View>
        </Section>

        {/* ── Languages ── */}
        <Section title="Languages spoken">
          <View style={styles.chipRow}>
            {LANGUAGE_OPTIONS.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.chip,
                  selectedLangs.has(lang.code) && styles.chipActive,
                ]}
                onPress={() => toggleLang(lang.code)}
              >
                <Text style={[
                  styles.chipText,
                  selectedLangs.has(lang.code) && styles.chipTextActive,
                ]}>
                  {lang.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        {/* ── Minimum Rating ── */}
        <Section title="Minimum rating">
          <View style={styles.ratingRow}>
            {RATING_OPTIONS.map((rating) => (
              <TouchableOpacity
                key={rating}
                style={[
                  styles.ratingChip,
                  minRating === rating && styles.ratingChipActive,
                ]}
                onPress={() => setMinRating(rating)}
              >
                <Text style={[
                  styles.ratingChipText,
                  minRating === rating && styles.ratingChipTextActive,
                ]}>
                  {rating === 0 ? 'Any' : `★ ${rating}+`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Apply button (sticky bottom) ── */}
      <View style={styles.applyContainer}>
        <TouchableOpacity
          style={styles.applyBtn}
          onPress={applyFilters}
          activeOpacity={0.85}
        >
          <Text style={styles.applyText}>
            Apply{activeFilterCount > 0 ? ` ${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''}` : ''}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FAF7F0',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D0',
  },
  backBtn: { padding: 4, marginRight: 8 },
  backIcon: { fontSize: 18, color: '#1C1C2E' },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
  },
  headerCount: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#C8691A',
  },
  resetBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  resetText: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#C4502A',
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16 },

  // Sections
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE6D8',
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },

  // Sort rows
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E8E0D0',
    backgroundColor: '#FFFFFF',
  },
  sortRowActive: {
    borderColor: '#C8691A',
    backgroundColor: '#FFF5EC',
  },
  sortRowLeft: { flex: 1 },
  sortRowLabel: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
  },
  sortRowLabelActive: { color: '#C8691A' },
  sortRowDesc: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
    marginTop: 1,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#E8E0D0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOuterActive: { borderColor: '#C8691A' },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#C8691A',
  },

  // Trust slider
  sliderLabel: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
    textAlign: 'center',
    marginBottom: 8,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderMarkers: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -4,
    marginBottom: 4,
  },
  sliderMarkerText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
  },
  sliderMarkerLine: {
    alignItems: 'center',
  },
  sliderMarkerTick: {
    fontSize: 9,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
    textAlign: 'center',
  },
  tierStrip: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 12,
    marginTop: 4,
  },
  tierSegment: { height: 4 },

  // Chips (distance + languages)
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8E0D0',
    backgroundColor: '#FFFFFF',
  },
  chipActive: {
    borderColor: '#C8691A',
    backgroundColor: '#FFF5EC',
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
  },
  chipTextActive: {
    color: '#C8691A',
    fontFamily: 'PlusJakartaSans-SemiBold',
  },

  // Toggles
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  toggleLabel: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
    flex: 1,
    marginRight: 12,
  },
  toggleSub: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
    marginTop: 1,
    flex: 1,
    marginRight: 12,
  },

  // Rating
  ratingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  ratingChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8E0D0',
    backgroundColor: '#FFFFFF',
  },
  ratingChipActive: {
    borderColor: '#D97706',
    backgroundColor: '#FFFBEC',
  },
  ratingChipText: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
  },
  ratingChipTextActive: {
    color: '#D97706',
    fontFamily: 'PlusJakartaSans-SemiBold',
  },

  // Apply button
  applyContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    paddingTop: 12,
    backgroundColor: '#FAF7F0',
    borderTopWidth: 1,
    borderTopColor: '#E8E0D0',
  },
  applyBtn: {
    backgroundColor: '#C8691A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyText: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#FAF7F0',
  },
});

export default SearchFilterScreen;
