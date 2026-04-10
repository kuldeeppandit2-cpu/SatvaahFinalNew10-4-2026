/**
 * SearchBar.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Warm Sand (#F0E4CC) background search bar.
 * Search icon left, mic icon right.
 * Tap → navigates to SearchScreen.
 * Supports controlled input when used inside SearchScreen.
 */

import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

const WARM_SAND = '#F0E4CC';
const DEEP_INK  = '#1C1C2E';
const SAFFRON   = '#C8691A';

// ─── Icons (inline SVG-free emoji replacements; swap with react-native-vector-icons) ──
const SearchIcon = () => (
  <Text style={styles.searchIcon}>🔍</Text>
);

const MicIcon = ({ onPress }: { onPress?: () => void }) => (
  <TouchableOpacity onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
    <Text style={styles.micIcon}>🎤</Text>
  </TouchableOpacity>
);

// ─── Props ────────────────────────────────────────────────────────────────────
interface SearchBarProps {
  /** If provided, renders as controlled input (SearchScreen mode) */
  value?:         string;
  onChangeText?:  (text: string) => void;
  onMicPress?:    () => void;
  placeholder?:   string;
  style?:         ViewStyle;
  /** When true the bar is a non-editable tap target → navigates to SearchScreen */
  tappable?:      boolean;
  /** Active tab for search intent capture */
  tab?:           'products' | 'services' | 'expertise' | 'establishments';
  autoFocus?:     boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChangeText,
  onMicPress,
  placeholder = 'Find trusted providers near you…',
  style,
  tappable = false,
  tab = 'services',
  autoFocus = false,
}) => {
  const navigation = useNavigation<any>();
  const scaleAnim  = useRef(new Animated.Value(1)).current;

  const handleTap = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start();
    navigation.navigate('Search', { tab });
  };

  const inner = (
    <View style={[styles.bar, style]}>
      <SearchIcon />
      {tappable ? (
        <Text style={styles.placeholder} numberOfLines={1}>
          {placeholder}
        </Text>
      ) : (
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#A89E92"
          autoFocus={autoFocus}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
      )}
      <MicIcon onPress={onMicPress} />
    </View>
  );

  if (tappable) {
    return (
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Pressable onPress={handleTap}>
          {inner}
        </Pressable>
      </Animated.View>
    );
  }

  return inner;
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  bar: {
    flexDirection:  'row',
    alignItems:     'center',
    backgroundColor: WARM_SAND,
    borderRadius:   28,
    paddingHorizontal: 16,
    paddingVertical:   12,
    gap:            10,
    shadowColor:    DEEP_INK,
    shadowOffset:   { width: 0, height: 2 },
    shadowOpacity:  0.07,
    shadowRadius:   6,
    elevation:      2,
  },
  input: {
    flex:       1,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   15,
    color:      DEEP_INK,
    padding:    0,
    margin:     0,
  },
  placeholder: {
    flex:       1,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   15,
    color:      '#A89E92',
  },
  searchIcon: {
    fontSize: 17,
  },
  micIcon: {
    fontSize: 17,
  },
});

export default SearchBar;
