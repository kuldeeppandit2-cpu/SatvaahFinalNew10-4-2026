/**
 * EmptySearchState.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Displayed when ring expansion reaches max (150 km) and no results found,
 * or when search yields zero matches. Encourages saving search intent so
 * the user is notified when a matching provider joins.
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';

const SAFFRON   = '#C8691A';
const VERDIGRIS = '#2E7D72';
const DEEP_INK  = '#1C1C2E';
const IVORY     = '#FAF7F0';

// ─── Props ────────────────────────────────────────────────────────────────────
interface EmptySearchStateProps {
  searchQuery:       string;
  /** Whether user can save search intent (logged in) */
  canSaveIntent?:    boolean;
  onSaveIntent?:     () => void;
  onBrowseAll?:      () => void;
  /** Has the search intent already been saved? */
  intentSaved?:      boolean;
  style?:            ViewStyle;
}

// ─── Component ────────────────────────────────────────────────────────────────
const EmptySearchState: React.FC<EmptySearchStateProps> = ({
  searchQuery,
  canSaveIntent = true,
  onSaveIntent,
  onBrowseAll,
  intentSaved = false,
  style,
}) => {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 10, useNativeDriver: true }),
    ]).start();
  }, []); // eslint-disable-line

  return (
    <Animated.View
      style={[
        styles.container,
        style,
        { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
      ]}
    >
      {/* Illustration */}
      <View style={styles.illustration}>
        <Text style={styles.emoji}>🔍</Text>
        {/* Concentric ring visual */}
        <View style={[styles.concentric, { width: 100, height: 100, borderRadius: 50 }]} />
        <View style={[styles.concentric, { width: 70, height: 70, borderRadius: 35 }]} />
        <View style={[styles.concentric, { width: 44, height: 44, borderRadius: 22 }]} />
      </View>

      <Text style={styles.title}>No matches found</Text>
      <Text style={styles.sub}>
        We searched everywhere for{' '}
        <Text style={styles.query}>"{searchQuery}"</Text>
        {' '}but couldn't find a trusted provider near you yet.
      </Text>

      {/* Save intent CTA */}
      {canSaveIntent && !intentSaved && (
        <TouchableOpacity
          style={styles.primaryCta}
          onPress={onSaveIntent}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryCtaText}>🔔 Notify me when one joins</Text>
        </TouchableOpacity>
      )}

      {intentSaved && (
        <View style={styles.savedBadge}>
          <Text style={styles.savedText}>✓ You'll be notified when a match joins</Text>
        </View>
      )}

      {onBrowseAll && (
        <TouchableOpacity onPress={onBrowseAll} style={styles.secondaryCta}>
          <Text style={styles.secondaryCtaText}>Browse all categories</Text>
        </TouchableOpacity>
      )}

      {/* Trust message */}
      <Text style={styles.trustNote}>
        SatvAAh verifies every provider. We'd rather show fewer than show unverified ones.
      </Text>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    alignItems:  'center',
    paddingTop:  48,
    paddingHorizontal: 32,
    paddingBottom: 32,
    gap:         16,
  },
  illustration: {
    position:       'relative',
    width:          100,
    height:         100,
    alignItems:     'center',
    justifyContent: 'center',
    marginBottom:   8,
  },
  concentric: {
    position:        'absolute',
    borderWidth:     1.5,
    borderColor:     SAFFRON + '20',
    backgroundColor: 'transparent',
  },
  emoji: {
    fontSize: 40,
    zIndex:   10,
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   20,
    color:      DEEP_INK,
    textAlign:  'center',
  },
  sub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   14,
    color:      '#6B6560',
    textAlign:  'center',
    lineHeight: 21,
  },
  query: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color:      DEEP_INK,
  },
  primaryCta: {
    backgroundColor:  SAFFRON,
    borderRadius:     28,
    paddingHorizontal: 24,
    paddingVertical:   14,
    marginTop:        8,
  },
  primaryCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      '#FFFFFF',
  },
  savedBadge: {
    backgroundColor:  VERDIGRIS + '15',
    borderRadius:     20,
    paddingHorizontal: 16,
    paddingVertical:   10,
    borderWidth:      1,
    borderColor:      VERDIGRIS + '30',
  },
  savedText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      VERDIGRIS,
  },
  secondaryCta: {
    paddingVertical: 8,
  },
  secondaryCtaText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      SAFFRON,
    textDecorationLine: 'underline',
  },
  trustNote: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#C4BCB4',
    textAlign:  'center',
    lineHeight: 16,
    marginTop:  8,
  },
});

export default EmptySearchState;
