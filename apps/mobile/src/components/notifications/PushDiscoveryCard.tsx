/**
 * PushDiscoveryCard.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * In-app card version of the push-discovery notification.
 * Shown when lambdas/push-discovery matches a search_intent to
 * a provider who just crossed the push_discovery_trust_threshold.
 *
 * Presents: new provider match, their trust score, distance,
 * "View profile" and "Save" CTAs, dismiss.
 *
 * Backend: lambdas/push-discovery/ → FCM → app reads from
 * notification_log and shows this card if app is foregrounded.
 */

import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import Avatar from '../common/Avatar';
import TrustRing from '../trust/TrustRing';
import TrustBadge from '../trust/TrustBadge';

const SAFFRON    = '#C8691A';
const VERDIGRIS  = '#2E7D72';
const DEEP_INK   = '#1C1C2E';
const IVORY      = '#FAF7F0';
const WARM_SAND  = '#F0E4CC';

// ─── Props ────────────────────────────────────────────────────────────────────
interface PushDiscoveryCardProps {
  /** Provider that just became discoverable */
  providerId:       string;
  providerName:     string;
  providerCategory: string;
  providerPhotoUrl?: string;
  trustScore:       number;
  distanceKm:       number;
  /** Search term that triggered the match */
  matchedQuery:     string;
  /** When the match occurred */
  matchedAt?:       string;  // ISO timestamp
  onViewProfile:    (providerId: string) => void;
  onSave?:          (providerId: string) => void;
  onDismiss:        () => void;
  style?:           ViewStyle;
}

// ─── Component ────────────────────────────────────────────────────────────────
const PushDiscoveryCard: React.FC<PushDiscoveryCardProps> = ({
  providerId,
  providerName,
  providerCategory,
  providerPhotoUrl,
  trustScore,
  distanceKm,
  matchedQuery,
  matchedAt,
  onViewProfile,
  onSave,
  onDismiss,
  style,
}) => {
  const slideAnim = useRef(new Animated.Value(40)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;

  // Animate in on mount
  React.useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0, tension: 60, friction: 10, useNativeDriver: true,
      }),
      Animated.timing(opacAnim, {
        toValue: 1, duration: 280, useNativeDriver: true,
      }),
    ]).start();
  }, []); // eslint-disable-line

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 40, duration: 220, useNativeDriver: true }),
      Animated.timing(opacAnim,  { toValue: 0,  duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  const distLabel = distanceKm < 1
    ? `${Math.round(distanceKm * 1000)} m away`
    : `${distanceKm.toFixed(1)} km away`;

  // Relative time
  const timeLabel = matchedAt
    ? (() => {
        const diffMs = Date.now() - new Date(matchedAt).getTime();
        const mins   = Math.floor(diffMs / 60000);
        if (mins < 1)  return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        return `${Math.floor(mins / 60)}h ago`;
      })()
    : undefined;

  return (
    <Animated.View
      style={[
        styles.card,
        style,
        {
          transform: [{ translateY: slideAnim }],
          opacity:   opacAnim,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.badge}>
          <Text style={styles.badgeIcon}>🔔</Text>
          <Text style={styles.badgeText}>New match for "{matchedQuery}"</Text>
        </View>
        <View style={styles.headerRight}>
          {timeLabel && <Text style={styles.time}>{timeLabel}</Text>}
          <Pressable
            onPress={handleDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.dismiss}>✕</Text>
          </Pressable>
        </View>
      </View>

      {/* Provider row */}
      <View style={styles.providerRow}>
        <View style={styles.photoWrap}>
          <Avatar
            name={providerName}
            photoUrl={providerPhotoUrl}
            size={56}
          />
          {/* Mini ring on avatar */}
          <View style={styles.miniRing}>
            <TrustRing score={trustScore} size={60} animated />
          </View>
        </View>

        <View style={styles.providerInfo}>
          <Text style={styles.providerName} numberOfLines={1}>{providerName}</Text>
          <Text style={styles.providerCat} numberOfLines={1}>{providerCategory}</Text>
          <TrustBadge score={trustScore} variant="compact" />
          <Text style={styles.distance}>📍 {distLabel}</Text>
        </View>
      </View>

      {/* Trust score highlight */}
      <View style={styles.trustRow}>
        <Text style={styles.trustLabel}>Trust Score</Text>
        <View style={styles.trustScore}>
          <Text style={styles.trustScoreNum}>{trustScore}</Text>
          <Text style={styles.trustScoreMax}>/100</Text>
        </View>
        <View style={styles.trustBar}>
          <View style={[styles.trustBarFill, { width: `${trustScore}%` as any }]} />
        </View>
      </View>

      {/* CTAs */}
      <View style={styles.ctaRow}>
        <TouchableOpacity
          style={styles.viewCta}
          onPress={() => onViewProfile(providerId)}
          activeOpacity={0.85}
        >
          <Text style={styles.viewCtaText}>View profile</Text>
        </TouchableOpacity>

        {onSave && (
          <TouchableOpacity
            style={styles.saveCta}
            onPress={() => onSave(providerId)}
            activeOpacity={0.8}
          >
            <Text style={styles.saveCtaText}>🤍 Save</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius:    20,
    padding:         16,
    borderWidth:     1,
    borderColor:     '#E8E0D4',
    shadowColor:     DEEP_INK,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.10,
    shadowRadius:    12,
    elevation:       5,
    gap:             12,
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  badge: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  SAFFRON + '15',
    borderRadius:     10,
    paddingHorizontal: 9,
    paddingVertical:   4,
    gap:              5,
    flex:             1,
  },
  badgeIcon: {
    fontSize: 12,
  },
  badgeText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   11,
    color:      SAFFRON,
    flex:       1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    marginLeft:    8,
  },
  time: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   10,
    color:      '#C4BCB4',
  },
  dismiss: {
    fontSize: 13,
    color:    '#C4BCB4',
  },
  providerRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  photoWrap: {
    position: 'relative',
    width:    66,
    height:   66,
  },
  miniRing: {
    position:       'absolute',
    top:            -5,
    left:           -5,
    pointerEvents:  'none',
  },
  providerInfo: {
    flex: 1,
    gap:  3,
  },
  providerName: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      DEEP_INK,
  },
  providerCat: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      '#9E9890',
  },
  distance: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#9E9890',
  },
  trustRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
    backgroundColor: WARM_SAND,
    borderRadius:   10,
    padding:        10,
  },
  trustLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#9E9890',
  },
  trustScore: {
    flexDirection: 'row',
    alignItems:    'baseline',
  },
  trustScoreNum: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   16,
    color:      VERDIGRIS,
  },
  trustScoreMax: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   10,
    color:      '#9E9890',
  },
  trustBar: {
    flex:            1,
    height:          5,
    backgroundColor: '#E8E0D4',
    borderRadius:    3,
    overflow:        'hidden',
  },
  trustBarFill: {
    height:          5,
    backgroundColor: VERDIGRIS,
    borderRadius:    3,
  },
  ctaRow: {
    flexDirection: 'row',
    gap:           10,
  },
  viewCta: {
    flex:            1,
    backgroundColor: SAFFRON,
    borderRadius:    24,
    paddingVertical: 12,
    alignItems:      'center',
  },
  viewCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      '#FFFFFF',
  },
  saveCta: {
    borderWidth:      1.5,
    borderColor:      '#D1C9BC',
    borderRadius:     24,
    paddingVertical:  12,
    paddingHorizontal: 18,
    alignItems:       'center',
  },
  saveCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      DEEP_INK,
  },
});

export default PushDiscoveryCard;
