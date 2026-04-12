/**
 * apps/mobile/src/screens/consumer/SearchScreen.tsx
 * SatvAAh Phase 18 — Taxonomy-Constrained Search
 *
 * Rules (from spec):
 *   • Taxonomy-constrained ONLY — never open free-text search
 *   • Min 2 chars to show suggestions
 *   • Max 8 results from taxonomy_nodes
 *   • Voice search: English (en-IN) / Telugu (te-IN) / Hindi (hi-IN)
 *   • storeSearchIntent is async, fire-and-forget, never fails UI
 *   • Selection required to proceed — search button disabled on free text
 *
 * Flow:
 *   1. User types ≥2 chars → getSearchSuggestions() → show max 8 nodes
 *   2. User taps node → storeSearchIntent() (fire-and-forget) → navigate to Results
 *   3. Voice: record → transcribe → search taxonomy → auto-select if 1 result
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  StatusBar,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useLocationStore } from '../../stores/location.store';
import {
  getSearchSuggestions,
  storeSearchIntent,
  type Tab,
  type SearchSuggestion,
} from '../../api/search.api';

// ─── Navigation Types ──────────────────────────────────────────────────────────

type ConsumerStackParamList = {
  Home: undefined;
  Search: { tab: Tab; initialQuery?: string };
  SearchResults: {
    query: string;
    taxonomyNodeId?: string;
    taxonomyL4?: string;
    taxonomyL3?: string;
    taxonomyL2?: string;
    taxonomyL1?: string;
    tab: Tab;
    locationName?: string;
  };
};

type Nav  = NativeStackNavigationProp<ConsumerStackParamList>;
type Route = RouteProp<ConsumerStackParamList, 'Search'>;

// ─── Voice Search ──────────────────────────────────────────────────────────────

type VoiceLang = { code: string; label: string; short: string };

const VOICE_LANGS: VoiceLang[] = [
  { code: 'en-IN', label: 'English', short: 'EN' },
  { code: 'te-IN', label: 'Telugu',  short: 'TE' },
  { code: 'hi-IN', label: 'Hindi',   short: 'HI' },
];

// Lazy-load @react-native-voice/voice to avoid crash if not linked
let Voice: any = null;
try {
  Voice = require('@react-native-voice/voice').default;
} catch {
  // Voice module not available — voice search gracefully disabled
}

// ─── Recent Searches Persistence ─────────────────────────────────────────────

const RECENT_KEY_PREFIX = 'satvaaah_recent_searches_';
const MAX_RECENT = 5;

async function saveRecentSearch(tab: Tab, node: SearchSuggestion): Promise<void> {
  try {
    const key = `${RECENT_KEY_PREFIX}${tab}`;
    const raw = await AsyncStorage.getItem(key);
    const existing: SearchSuggestion[] = raw ? JSON.parse(raw) : [];
    const filtered = existing.filter((n) => n.id !== node.id);
    const updated = [node, ...filtered].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // Non-critical
  }
}

async function loadRecentSearches(tab: Tab): Promise<SearchSuggestion[]> {
  try {
    const key = `${RECENT_KEY_PREFIX}${tab}`;
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const SearchScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { tab = "services", initialQuery } = route.params ?? {};

  // ── State ──────────────────────────────────────────────────────────────────
  const [inputText, setInputText]                 = useState(initialQuery ?? '');
  const [selectedNode, setSelectedNode]           = useState<SearchSuggestion | null>(null);
  const [suggestions, setSuggestions]             = useState<SearchSuggestion[]>([]);
  const [recentSearches, setRecentSearches]       = useState<SearchSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [voiceActive, setVoiceActive]             = useState(false);
  const [voiceLang, setVoiceLang]                 = useState<VoiceLang>(VOICE_LANGS[0]);
  const [showLangPicker, setShowLangPicker]       = useState(false);

  const inputRef     = useRef<TextInput>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micPulse     = useRef(new Animated.Value(1)).current;

  // ── Load recent searches on mount ─────────────────────────────────────────
  useEffect(() => {
    loadRecentSearches(tab).then(setRecentSearches);
    // Auto-focus input
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [tab]);

  // ── Mic pulse animation ───────────────────────────────────────────────────
  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    if (voiceActive) {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(micPulse, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(micPulse, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ]),
      );
      anim.start();
    } else {
      micPulse.setValue(1);
    }
    return () => anim?.stop();
  }, [voiceActive, micPulse]);

  // ── Setup Voice listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!Voice) return;
    Voice.onSpeechResults = (e: any) => {
      const transcript: string = e.value?.[0] ?? '';
      if (transcript) {
        setInputText(transcript);
        setVoiceActive(false);
        // Immediately search taxonomy for the transcript
        fetchSuggestions(transcript);
      }
    };
    Voice.onSpeechError = () => {
      setVoiceActive(false);
    };
    Voice.onSpeechEnd = () => {
      setVoiceActive(false);
    };
    return () => {
      Voice?.destroy().catch(() => {});
    };
  }, []);

  // ── Taxonomy suggestions fetch ────────────────────────────────────────────

  const fetchSuggestions = useCallback(
    async (text: string) => {
      if (text.trim().length < 2) {
        setSuggestions([]);
        setLoadingSuggestions(false);
        return;
      }
      setLoadingSuggestions(true);
      try {
        const results = await getSearchSuggestions(text, tab);
        setSuggestions(results);
        // If voice triggered and exactly 1 result — auto-select
        if (voiceActive && results.length === 1) {
          handleNodeSelect(results[0]);
        }
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    },
    [tab, voiceActive],
  );

  const onInputChange = useCallback(
    (text: string) => {
      setInputText(text);
      setSelectedNode(null); // Clear selection on new input
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(text);
      }, 300);
    },
    [fetchSuggestions],
  );

  // ── Node selection ────────────────────────────────────────────────────────

  const handleNodeSelect = useCallback(
    (node: SearchSuggestion) => {
      setSelectedNode(node);
      setInputText(node.name);
      setSuggestions([]);
      // Fire-and-forget intent (V012) — NEVER blocks navigation
      storeSearchIntent({
        taxonomy_node_id: node.id,
        lat: useLocationStore.getState().lat,
        lng: useLocationStore.getState().lng,
      });
      // Save to recent
      saveRecentSearch(tab, node);
      // Navigate — use node.tab (the taxonomy node's correct tab, not the route param)
      // Pass full taxonomy anchor so backend can apply the most specific filter
      navigation.navigate('SearchResults', {
        query:          node.name,
        taxonomyNodeId: node.id,
        taxonomyL4:     node.l4  ?? node.name,
        taxonomyL3:     node.l3  ?? undefined,
        taxonomyL2:     node.l2  ?? undefined,
        taxonomyL1:     node.l1,
        tab:            node.tab as Tab,
      });
    },
    [tab, navigation],
  );

  // ── Voice Search ──────────────────────────────────────────────────────────

  const startVoice = useCallback(async () => {
    if (!Voice) {
      Alert.alert('Voice search', 'Voice search is not available on this device.');
      return;
    }
    try {
      setVoiceActive(true);
      setInputText('');
      setSuggestions([]);
      await Voice.start(voiceLang.code);
    } catch {
      setVoiceActive(false);
    }
  }, [voiceLang]);

  const stopVoice = useCallback(async () => {
    try {
      await Voice?.stop();
    } catch {
      // Ignore
    }
    setVoiceActive(false);
  }, []);

  const onVoicePress = useCallback(() => {
    if (voiceActive) {
      stopVoice();
    } else {
      startVoice();
    }
  }, [voiceActive, startVoice, stopVoice]);

  // ── Clear input ───────────────────────────────────────────────────────────

  const clearInput = useCallback(() => {
    setInputText('');
    setSelectedNode(null);
    setSuggestions([]);
    inputRef.current?.focus();
  }, []);

  // ── Suggestion row render ─────────────────────────────────────────────────

  const renderSuggestion = useCallback(
    ({ item }: { item: SearchSuggestion }) => {
      const breadcrumb = [item.l1, item.l2, item.l3, item.l4]
        .filter(Boolean)
        .join(' › ');
      return (
        <TouchableOpacity
          style={styles.suggestionRow}
          onPress={() => handleNodeSelect(item)}
          activeOpacity={0.75}
        >
          <View style={styles.suggestionIcon}>
            <Text style={styles.suggestionIconText}>🔎</Text>
          </View>
          <View style={styles.suggestionText}>
            <Text style={styles.suggestionName}>{item.name}</Text>
            {breadcrumb.length > item.name.length + 2 && (
              <Text style={styles.suggestionBreadcrumb} numberOfLines={1}>
                {breadcrumb}
              </Text>
            )}
          </View>
          {item.homeVisit && (
            <Text style={styles.homeVisitBadge}>🏠</Text>
          )}
        </TouchableOpacity>
      );
    },
    [handleNodeSelect],
  );

  const renderRecentItem = useCallback(
    ({ item }: { item: SearchSuggestion }) => (
      <TouchableOpacity
        style={styles.recentRow}
        onPress={() => handleNodeSelect(item)}
        activeOpacity={0.75}
      >
        <Text style={styles.recentIcon}>🕐</Text>
        <Text style={styles.recentName}>{item.name}</Text>
        <Text style={styles.recentTab}>{item.tab}</Text>
      </TouchableOpacity>
    ),
    [handleNodeSelect],
  );

  // ── Determine what to show in body ────────────────────────────────────────
  const showSuggestions = inputText.trim().length >= 2;
  const showRecents     = !showSuggestions && recentSearches.length > 0;
  const showEmptyHint   = !showSuggestions && !showRecents;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ── Search Header ── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>

          <View style={styles.inputWrapper}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={inputText}
              onChangeText={onInputChange}
              placeholder={`Search ${tab}…`}
              placeholderTextColor="#9B8E7C"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              // Prevent return key from submitting free text — must select from taxonomy
              onSubmitEditing={() => {
                if (suggestions.length === 1) handleNodeSelect(suggestions[0]);
              }}
            />
            {inputText.length > 0 && (
              <TouchableOpacity onPress={clearInput} style={styles.clearBtn}>
                <Text style={styles.clearIcon}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Voice button */}
          <Animated.View style={{ transform: [{ scale: voiceActive ? micPulse : 1 }] }}>
            <TouchableOpacity
              style={[styles.voiceBtn, voiceActive && styles.voiceBtnActive]}
              onPress={onVoicePress}
              onLongPress={() => setShowLangPicker(true)}
              accessibilityLabel={voiceActive ? 'Stop voice search' : `Voice search in ${voiceLang.label}`}
            >
              <Text style={styles.voiceIcon}>🎤</Text>
              <Text style={styles.voiceLangLabel}>{voiceLang.short}</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* ── Voice language picker ── */}
        {showLangPicker && (
          <View style={styles.langPicker}>
            <Text style={styles.langPickerTitle}>Search language</Text>
            {VOICE_LANGS.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[styles.langRow, voiceLang.code === lang.code && styles.langRowSelected]}
                onPress={() => {
                  setVoiceLang(lang);
                  setShowLangPicker(false);
                }}
              >
                <Text style={[
                  styles.langRowText,
                  voiceLang.code === lang.code && styles.langRowTextSelected,
                ]}>
                  {lang.label}
                </Text>
                {voiceLang.code === lang.code && <Text>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Taxonomy constraint notice ── */}
        <View style={styles.constraintBar}>
          <Text style={styles.constraintText}>
            Select from categories — free text search is not supported
          </Text>
        </View>

        {/* ── Body: suggestions / recent / hint ── */}
        {showSuggestions && (
          <>
            {loadingSuggestions ? (
              <ActivityIndicator
                color="#C8691A"
                style={{ marginTop: 24 }}
              />
            ) : suggestions.length > 0 ? (
              <FlatList
                data={suggestions}
                keyExtractor={(item) => item.id}
                renderItem={renderSuggestion}
                keyboardShouldPersistTaps="always"
                style={styles.list}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
              />
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🔍</Text>
                <Text style={styles.emptyTitle}>No categories found</Text>
                <Text style={styles.emptyBody}>
                  Try a different term — SatvAAh searches within our
                  trusted taxonomy only.
                </Text>
              </View>
            )}
          </>
        )}

        {showRecents && (
          <View>
            <Text style={styles.recentHeading}>Recent searches</Text>
            <FlatList
              data={recentSearches}
              keyExtractor={(item) => item.id}
              renderItem={renderRecentItem}
              keyboardShouldPersistTaps="always"
              style={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        )}

        {showEmptyHint && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>💡</Text>
            <Text style={styles.emptyTitle}>What are you looking for?</Text>
            <Text style={styles.emptyBody}>
              Type at least 2 characters to see matching categories,
              or tap the mic for voice search.
            </Text>
          </View>
        )}

        {/* Voice active overlay */}
        {voiceActive && (
          <View style={styles.voiceOverlay}>
            <Animated.View style={[styles.voicePulseRing, {
              transform: [{ scale: micPulse }],
              opacity: micPulse.interpolate({ inputRange: [1, 1.3], outputRange: [0.6, 0] }),
            }]} />
            <Text style={styles.voiceOverlayIcon}>🎤</Text>
            <Text style={styles.voiceOverlayLang}>Listening in {voiceLang.label}…</Text>
            <TouchableOpacity onPress={stopVoice} style={styles.voiceStopBtn}>
              <Text style={styles.voiceStopText}>Stop</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D0',
    backgroundColor: '#FAF7F0',
  },
  backBtn: {
    padding: 8,
    marginRight: 4,
  },
  backIcon: {
    fontSize: 20,
    color: '#1C1C2E',
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0E4CC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    padding: 0,
  },
  clearBtn: {
    padding: 4,
  },
  clearIcon: {
    fontSize: 14,
    color: '#9B8E7C',
  },

  // Voice
  voiceBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0E4CC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceBtnActive: {
    backgroundColor: '#C8691A',
  },
  voiceIcon: {
    fontSize: 18,
  },
  voiceLangLabel: {
    fontSize: 8,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
    marginTop: -2,
  },

  // Language picker
  langPicker: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 10,
  },
  langPickerTitle: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  langRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  langRowSelected: {
    backgroundColor: '#FFF5EC',
  },
  langRowText: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
  },
  langRowTextSelected: {
    color: '#C8691A',
    fontFamily: 'PlusJakartaSans-SemiBold',
  },

  // Constraint bar
  constraintBar: {
    backgroundColor: '#FFF5EC',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  constraintText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#C8691A',
    textAlign: 'center',
  },

  // Lists
  list: {
    flex: 1,
    backgroundColor: '#FAF7F0',
  },
  separator: {
    height: 1,
    backgroundColor: '#EDE6D8',
    marginLeft: 56,
  },

  // Suggestion row
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FAF7F0',
  },
  suggestionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0E4CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  suggestionIconText: {
    fontSize: 16,
  },
  suggestionText: {
    flex: 1,
  },
  suggestionName: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
  },
  suggestionBreadcrumb: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
    marginTop: 1,
  },
  homeVisitBadge: {
    fontSize: 16,
    marginLeft: 8,
  },

  // Recent searches
  recentHeading: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FAF7F0',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  recentIcon: {
    fontSize: 16,
    marginRight: 12,
    opacity: 0.5,
  },
  recentName: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
  },
  recentTab: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
    textTransform: 'capitalize',
  },

  // Empty / hint states
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Voice overlay
  voiceOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28, 28, 46, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voicePulseRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: '#C8691A',
  },
  voiceOverlayIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  voiceOverlayLang: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#FAF7F0',
    marginBottom: 32,
  },
  voiceStopBtn: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    backgroundColor: '#C4502A',
    borderRadius: 24,
  },
  voiceStopText: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#FAF7F0',
  },
});

export default SearchScreen;
