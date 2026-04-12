/**
 * SearchScreen — S2 Free Text Search
 *
 * Two inputs:
 *   1. What are you looking for? (taxonomy search with autocomplete)
 *   2. Where? (location — taps into LocationPickerScreen)
 *
 * Flow:
 *   1. User types ≥2 chars → getSearchSuggestions() → max 8 taxonomy nodes
 *   2. User taps suggestion → storeSearchIntent (fire-and-forget)
 *      → if location set: navigate to SearchResults
 *      → if no location: navigate to LocationPickerScreen first
 *   3. Voice: record → transcribe → auto-select if 1 match
 */

import React, {
  useState, useRef, useCallback, useEffect,
} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Animated, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useLocationStore } from '../../stores/location.store';
import {
  getSearchSuggestions,
  storeSearchIntent,
  type Tab,
  type SearchSuggestion,
} from '../../api/search.api';
import { COLORS } from '../../constants/colors';

// ─── Nav types ────────────────────────────────────────────────────────────────

type Stack = {
  Search:         { tab?: Tab; initialQuery?: string };
  SearchResults:  {
    query: string; tab: Tab; locationName?: string;
    taxonomyNodeId?: string; taxonomyL4?: string;
    taxonomyL3?: string; taxonomyL2?: string; taxonomyL1?: string;
  };
  LocationPicker: {
    query: string; tab: string; locationName?: string;
    taxonomyNodeId?: string; taxonomyL4?: string;
    taxonomyL3?: string; taxonomyL2?: string; taxonomyL1?: string;
  };
};

type Nav   = NativeStackNavigationProp<Stack>;
type Route = RouteProp<Stack, 'Search'>;

// ─── Recent searches ──────────────────────────────────────────────────────────

const RECENT_KEY = 'satvaaah_recent_s2_';
const MAX_RECENT = 5;

async function saveRecent(tab: Tab, node: SearchSuggestion) {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY + tab);
    const existing: SearchSuggestion[] = raw ? JSON.parse(raw) : [];
    const updated = [node, ...existing.filter(n => n.id !== node.id)].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(RECENT_KEY + tab, JSON.stringify(updated));
  } catch {}
}

async function loadRecent(tab: Tab): Promise<SearchSuggestion[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY + tab);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ─── Voice (optional) ─────────────────────────────────────────────────────────

let Voice: any = null;
try { Voice = require('@react-native-voice/voice').default; } catch {}

const VOICE_LANGS = [
  { code: 'en-IN', label: 'English', short: 'EN' },
  { code: 'te-IN', label: 'Telugu',  short: 'TE' },
  { code: 'hi-IN', label: 'Hindi',   short: 'HI' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

const SearchScreen: React.FC = () => {
  const navigation  = useNavigation<Nav>();
  const route       = useRoute<Route>();
  const { tab = 'services', initialQuery } = route.params ?? {};

  const { lat, lng } = useLocationStore();
  const locationName  = useLocationStore(s => {
    // Derive a display name from coords — Hyderabad default shows as "Hyderabad"
    if (s.lat === 17.385 && s.lng === 78.4867) return 'Hyderabad';
    return `${s.lat.toFixed(2)}°N, ${s.lng.toFixed(2)}°E`;
  });

  // ── State ──────────────────────────────────────────────────────────────────
  const [query,        setQuery]        = useState(initialQuery ?? '');
  const [selected,     setSelected]     = useState<SearchSuggestion | null>(null);
  const [suggestions,  setSuggestions]  = useState<SearchSuggestion[]>([]);
  const [recents,      setRecents]      = useState<SearchSuggestion[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [voiceActive,  setVoiceActive]  = useState(false);
  const [voiceLang,    setVoiceLang]    = useState(VOICE_LANGS[0]);
  const [showLangMenu, setShowLangMenu] = useState(false);

  const inputRef    = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micPulse    = useRef(new Animated.Value(1)).current;

  // ── Load recents on focus ─────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    loadRecent(tab as Tab).then(setRecents);
    setTimeout(() => inputRef.current?.focus(), 150);
  }, [tab]));

  // ── Mic animation ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!voiceActive) { micPulse.setValue(1); return; }
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(micPulse, { toValue: 1.3, duration: 600, useNativeDriver: true }),
      Animated.timing(micPulse, { toValue: 1.0, duration: 600, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [voiceActive, micPulse]);

  // ── Voice setup ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!Voice) return;
    Voice.onSpeechResults = (e: any) => {
      const t = e.value?.[0] ?? '';
      if (t) { setQuery(t); setVoiceActive(false); fetchSuggestions(t); }
    };
    Voice.onSpeechError = () => setVoiceActive(false);
    Voice.onSpeechEnd   = () => setVoiceActive(false);
    return () => { Voice?.destroy().catch(() => {}); };
  }, []);

  // ── Fetch taxonomy suggestions ────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (text: string) => {
    if (text.trim().length < 2) { setSuggestions([]); return; }
    setLoading(true);
    try {
      const results = await getSearchSuggestions(text, tab);
      const filtered = (results ?? []).filter(r => r?.id && r?.name);
      setSuggestions(filtered);
      // Auto-select single match
      if (filtered.length === 1) handleNodeSelect(filtered[0]);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const onQueryChange = useCallback((text: string) => {
    setQuery(text);
    setSelected(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(() => fetchSuggestions(text), 300);
  }, [fetchSuggestions]);

  // ── Node select → go to LocationPicker if no location, else SearchResults ──
  const handleNodeSelect = useCallback((node: SearchSuggestion) => {
    setSelected(node);
    setQuery(node.name);
    setSuggestions([]);
    saveRecent(tab as Tab, node);
    storeSearchIntent({
      taxonomy_node_id: node.id,
      lat: useLocationStore.getState().lat,
      lng: useLocationStore.getState().lng,
    });

    const params = {
      query:          node.name,
      taxonomyNodeId: node.id,
      taxonomyL4:     node.l4  ?? node.name,
      taxonomyL3:     node.l3  ?? undefined,
      taxonomyL2:     node.l2  ?? undefined,
      taxonomyL1:     node.l1,
      tab:            (node.tab ?? tab) as Tab,
      locationName,
    };

    // Always go via LocationPicker so user confirms / changes location
    navigation.navigate('LocationPicker', { ...params, tab: params.tab });
  }, [tab, navigation, locationName]);

  // ── Voice handlers ────────────────────────────────────────────────────────
  const onVoicePress = useCallback(async () => {
    if (voiceActive) { await Voice?.stop(); setVoiceActive(false); return; }
    if (!Voice) { Alert.alert('Voice search not available on this device.'); return; }
    try {
      setVoiceActive(true); setQuery(''); setSuggestions([]);
      await Voice.start(voiceLang.code);
    } catch { setVoiceActive(false); }
  }, [voiceActive, voiceLang]);

  // ── Location row press ────────────────────────────────────────────────────
  const onLocationPress = useCallback(() => {
    // Navigate to LocationPicker with current taxonomy selection preserved
    const base = selected ? {
      query:          selected.name,
      taxonomyNodeId: selected.id,
      taxonomyL4:     selected.l4 ?? selected.name,
      taxonomyL3:     selected.l3 ?? undefined,
      taxonomyL2:     selected.l2 ?? undefined,
      taxonomyL1:     selected.l1,
      tab:            (selected.tab ?? tab) as string,
    } : { query: query || '', tab };

    navigation.navigate('LocationPicker', { ...base, tab: base.tab as string });
  }, [selected, query, tab, navigation]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const showSuggestions = query.trim().length >= 2;
  const showRecents     = !showSuggestions && recents.length > 0 && !selected;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* ── Header row ── */}
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
            <Ionicons name="chevron-back" size={24} color={COLORS.deepInk} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Search</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* ── BOX 1: What are you looking for? ── */}
        <View style={s.boxLabel}>
          <Ionicons name="search-outline" size={14} color={COLORS.muted} />
          <Text style={s.boxLabelText}>What are you looking for?</Text>
        </View>
        <View style={s.inputRow}>
          <TextInput
            ref={inputRef}
            style={s.input}
            value={query}
            onChangeText={onQueryChange}
            placeholder="e.g. AC repair, cook, lawyer…"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => { if (suggestions.length === 1) handleNodeSelect(suggestions[0]); }}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); setSelected(null); setSuggestions([]); inputRef.current?.focus(); }} style={s.clearBtn}>
              <Ionicons name="close-circle" size={18} color={COLORS.muted} />
            </TouchableOpacity>
          )}
          {/* Voice button */}
          <Animated.View style={{ transform: [{ scale: voiceActive ? micPulse : 1 }] }}>
            <TouchableOpacity
              style={[s.voiceBtn, voiceActive && s.voiceBtnActive]}
              onPress={onVoicePress}
              onLongPress={() => setShowLangMenu(true)}
            >
              <Ionicons name="mic" size={18} color={voiceActive ? COLORS.ivory : COLORS.deepInk} />
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Selected node chip */}
        {selected && (
          <View style={s.selectedChip}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.verdigris} />
            <Text style={s.selectedChipText} numberOfLines={1}>{selected.name}</Text>
            <Text style={s.selectedBreadcrumb} numberOfLines={1}>
              {[selected.l1, selected.l2, selected.l3].filter(Boolean).join(' › ')}
            </Text>
          </View>
        )}

        {/* ── BOX 2: Where? ── */}
        <View style={s.boxLabel}>
          <Ionicons name="location-outline" size={14} color={COLORS.muted} />
          <Text style={s.boxLabelText}>Where?</Text>
        </View>
        <TouchableOpacity style={s.locationRow} onPress={onLocationPress} activeOpacity={0.75}>
          <Ionicons name="location" size={18} color={COLORS.saffron} style={{ marginRight: 10 }} />
          <Text style={s.locationText} numberOfLines={1}>{locationName}</Text>
          <Text style={s.changeText}>Change</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
        </TouchableOpacity>

        {/* Voice lang picker */}
        {showLangMenu && (
          <View style={s.langMenu}>
            <Text style={s.langMenuTitle}>Voice language</Text>
            {VOICE_LANGS.map(lang => (
              <TouchableOpacity key={lang.code} style={[s.langRow, voiceLang.code === lang.code && s.langRowActive]}
                onPress={() => { setVoiceLang(lang); setShowLangMenu(false); }}>
                <Text style={[s.langRowText, voiceLang.code === lang.code && s.langRowTextActive]}>{lang.label}</Text>
                {voiceLang.code === lang.code && <Ionicons name="checkmark" size={16} color={COLORS.saffron} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Suggestions list ── */}
        {showSuggestions && (
          loading
            ? <ActivityIndicator color={COLORS.saffron} style={{ marginTop: 24 }} />
            : suggestions.length > 0
              ? <FlatList
                  data={suggestions}
                  keyExtractor={item => item.id}
                  keyboardShouldPersistTaps="always"
                  style={s.list}
                  ItemSeparatorComponent={() => <View style={s.sep} />}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={s.suggRow} onPress={() => handleNodeSelect(item)} activeOpacity={0.75}>
                      <View style={s.suggIcon}><Text style={{ fontSize: 16 }}>🔎</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.suggName}>{item.name ?? ''}</Text>
                        <Text style={s.suggCrumb} numberOfLines={1}>
                          {[item.l1, item.l2, item.l3].filter(Boolean).join(' › ')}
                        </Text>
                      </View>
                      {item.homeVisit && <Text style={{ fontSize: 14 }}>🏠</Text>}
                    </TouchableOpacity>
                  )}
                />
              : <View style={s.empty}>
                  <Text style={s.emptyIcon}>🔍</Text>
                  <Text style={s.emptyTitle}>No categories found</Text>
                  <Text style={s.emptyBody}>Try a different term — e.g. "nai", "bai", "bijli wala"</Text>
                </View>
        )}

        {/* ── Recent searches ── */}
        {showRecents && (
          <>
            <Text style={s.recentHeading}>Recent searches</Text>
            <FlatList
              data={recents}
              keyExtractor={item => item.id}
              keyboardShouldPersistTaps="always"
              style={s.list}
              ItemSeparatorComponent={() => <View style={s.sep} />}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.suggRow} onPress={() => handleNodeSelect(item)} activeOpacity={0.75}>
                  <Ionicons name="time-outline" size={20} color={COLORS.muted} style={{ marginRight: 12 }} />
                  <Text style={[s.suggName, { flex: 1 }]}>{item.name}</Text>
                  <Text style={s.suggCrumb}>{item.tab}</Text>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* ── Hint when nothing typed ── */}
        {!showSuggestions && !showRecents && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>💡</Text>
            <Text style={s.emptyTitle}>What are you looking for?</Text>
            <Text style={s.emptyBody}>Type at least 2 characters — try "cook", "plumber", "lawyer"</Text>
          </View>
        )}

        {/* ── Voice overlay ── */}
        {voiceActive && (
          <View style={s.voiceOverlay}>
            <Animated.View style={[s.voiceRing, {
              transform: [{ scale: micPulse }],
              opacity: micPulse.interpolate({ inputRange: [1, 1.3], outputRange: [0.6, 0] }),
            }]} />
            <Ionicons name="mic" size={56} color={COLORS.ivory} style={{ marginBottom: 16 }} />
            <Text style={s.voiceOverlayLang}>Listening in {voiceLang.label}…</Text>
            <TouchableOpacity onPress={onVoicePress} style={s.voiceStopBtn}>
              <Text style={s.voiceStopText}>Stop</Text>
            </TouchableOpacity>
          </View>
        )}

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: COLORS.ivory },
  headerRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle:      { fontSize: 17, fontWeight: '700', color: COLORS.deepInk },

  boxLabel:         { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  boxLabelText:     { fontSize: 12, fontWeight: '600', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4 },

  inputRow:         { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6, gap: 8 },
  input:            { flex: 1, fontSize: 15, color: COLORS.deepInk },
  clearBtn:         { padding: 2 },
  voiceBtn:         { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.warmSand, justifyContent: 'center', alignItems: 'center' },
  voiceBtnActive:   { backgroundColor: COLORS.saffron },

  selectedChip:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginTop: 6, backgroundColor: '#EAF5F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  selectedChipText: { fontSize: 13, fontWeight: '600', color: COLORS.verdigris, flex: 1 },
  selectedBreadcrumb: { fontSize: 11, color: COLORS.muted },

  locationRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 14 },
  locationText:     { flex: 1, fontSize: 15, color: COLORS.deepInk, fontWeight: '500' },
  changeText:       { fontSize: 13, color: COLORS.saffron, fontWeight: '600', marginRight: 4 },

  langMenu:         { backgroundColor: COLORS.white, marginHorizontal: 16, marginTop: 4, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border, zIndex: 10 },
  langMenuTitle:    { fontSize: 11, fontWeight: '600', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  langRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  langRowActive:    { backgroundColor: '#FFF5EC' },
  langRowText:      { fontSize: 14, color: COLORS.deepInk },
  langRowTextActive:{ color: COLORS.saffron, fontWeight: '600' },

  list:             { flex: 1 },
  sep:              { height: 1, backgroundColor: COLORS.border, marginLeft: 52 },
  suggRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  suggIcon:         { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.warmSand, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  suggName:         { fontSize: 14, fontWeight: '600', color: COLORS.deepInk },
  suggCrumb:        { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  recentHeading:    { fontSize: 11, fontWeight: '600', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },

  empty:            { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 80 },
  emptyIcon:        { fontSize: 40, marginBottom: 12 },
  emptyTitle:       { fontSize: 16, fontWeight: '600', color: COLORS.deepInk, textAlign: 'center', marginBottom: 8 },
  emptyBody:        { fontSize: 13, color: COLORS.muted, textAlign: 'center', lineHeight: 20 },

  voiceOverlay:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(28,28,46,0.92)', justifyContent: 'center', alignItems: 'center' },
  voiceRing:        { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: COLORS.saffron },
  voiceOverlayLang: { fontSize: 16, color: COLORS.ivory, marginBottom: 32 },
  voiceStopBtn:     { paddingHorizontal: 28, paddingVertical: 12, backgroundColor: COLORS.saffron, borderRadius: 24 },
  voiceStopText:    { fontSize: 14, fontWeight: '600', color: COLORS.ivory },
});

export default SearchScreen;
