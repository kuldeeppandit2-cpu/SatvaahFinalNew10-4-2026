/**
 * SatvAAh Splash Screen
 * Saffron #C8691A BG · Ivory wordmark · 1.5s auto-proceed
 * Routing: no token → Auth | valid token → mode home screen
 * Config: splash_duration_seconds=1.5
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuthStore } from '../../stores/auth.store';
import { COLORS } from '../../constants/colors';
import type { RootStackParamList } from '../../navigation/types';

type SplashNav = NativeStackNavigationProp<RootStackParamList>;

// Config: splash_duration_seconds=1.5 (from system_config — hardcode default here)
const SPLASH_DURATION_MS = 1_500;

export function SplashScreen(): React.ReactElement {
  const navigation = useNavigation<SplashNav>();
  const accessToken = useAuthStore((s) => s.accessToken);
  const mode = useAuthStore((s) => s.mode);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  // Fade-in animation for the wordmark
  const opacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  useEffect(() => {
    if (!isHydrated) return;

    const timer = setTimeout(() => {
      if (!accessToken) {
        // No session — go to auth
        navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
      } else if (mode === 'consumer') {
        navigation.reset({ index: 0, routes: [{ name: 'ConsumerApp' }] });
      } else if (mode === 'provider') {
        navigation.reset({ index: 0, routes: [{ name: 'ProviderApp' }] });
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
      }
    }, SPLASH_DURATION_MS);

    return () => clearTimeout(timer);
  }, [isHydrated, accessToken, mode, navigation]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.wordmarkContainer, { opacity }]}>
        {/* SatvAAh — capital S, capital A, capital A, lowercase h */}
        <Text style={styles.wordmark}>SatvAAh</Text>
        <Text style={styles.tagline}>Truth that travels.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.saffron, // #C8691A — full bleed
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmarkContainer: {
    alignItems: 'center',
  },
  wordmark: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 48,
    color: COLORS.ivory,   // #FAF7F0
    letterSpacing: -1,
  },
  tagline: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontStyle: 'italic',
    fontSize: 16,
    color: COLORS.ivory,
    marginTop: 8,
    opacity: 0.9,
  },
});
