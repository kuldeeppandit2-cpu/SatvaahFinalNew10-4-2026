/**
 * OfflineBanner.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Terracotta banner that slides down from the top when network is offline.
 * Uses @react-native-community/netinfo to detect connectivity.
 * Slides back up when connection restores, briefly shows "Back online".
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';

const TERRACOTTA    = '#C0392B';
const TERRACOTTA_BG = '#C0392B';
const VERDIGRIS     = '#2E7D72';

type BannerState = 'hidden' | 'offline' | 'restored';

// ─── Component ────────────────────────────────────────────────────────────────
const OfflineBanner: React.FC = () => {
  const [state, setState]      = useState<BannerState>('hidden');
  const slideAnim              = useRef(new Animated.Value(-60)).current;
  const restoreTimer           = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slideIn  = () =>
    Animated.spring(slideAnim, {
      toValue: 0, tension: 80, friction: 9, useNativeDriver: true,
    }).start();

  const slideOut = (delay = 0) =>
    Animated.timing(slideAnim, {
      toValue: -60, duration: 300, delay, useNativeDriver: true,
    }).start(() => setState('hidden'));

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState) => {
      const isOnline = netState.isConnected && netState.isInternetReachable !== false;

      if (!isOnline) {
        if (restoreTimer.current) clearTimeout(restoreTimer.current);
        setState('offline');
        slideIn();
      } else if (state === 'offline' || state === 'restored') {
        setState('restored');
        // Show "Back online" for 2s then hide
        restoreTimer.current = setTimeout(() => {
          slideOut();
        }, 2000);
        // Re-animate in (already visible) — colour change handled via state
      }
    });

    return () => {
      unsubscribe();
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    };
  }, [state]); // eslint-disable-line

  if (state === 'hidden') return null;

  const isRestored = state === 'restored';
  const bg         = isRestored ? VERDIGRIS : TERRACOTTA_BG;
  const icon       = isRestored ? '✓' : '⚠';
  const message    = isRestored
    ? 'Back online'
    : 'No internet connection';
  const sub        = isRestored
    ? 'Reconnected — syncing data…'
    : 'Check your connection. Some features may be unavailable.';

  return (
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor: bg, transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents="none"
    >
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.row}>
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <Text style={styles.icon}>{icon}</Text>
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.message}>{message}</Text>
            <Text style={styles.sub}>{sub}</Text>
          </View>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  banner: {
    position:   'absolute',
    top:        0,
    left:       0,
    right:      0,
    zIndex:     9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.20,
    shadowRadius:  8,
    elevation:     8,
  },
  safeArea: {
    paddingHorizontal: 16,
    paddingBottom:     12,
    paddingTop:        6,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
  },
  iconWrap: {
    width:          28,
    height:         28,
    borderRadius:   14,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  icon: {
    color:    '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  textWrap: {
    flex: 1,
    gap:  1,
  },
  message: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      '#FFFFFF',
  },
  sub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      'rgba(255,255,255,0.80)',
  },
});

export default OfflineBanner;
