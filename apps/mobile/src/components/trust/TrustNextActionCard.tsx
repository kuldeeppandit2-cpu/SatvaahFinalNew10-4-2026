/**
 * TrustNextActionCard.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Dismissable card recommending the next verification action
 * to improve trust score. Driven by what signals are missing.
 * Slides out on dismiss with spring animation.
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

const VERDIGRIS  = '#2E7D72';
const SAFFRON    = '#C8691A';
const IVORY      = '#FAF7F0';
const DEEP_INK   = '#1C1C2E';

// ─── Types ────────────────────────────────────────────────────────────────────
export type NextActionType =
  | 'add_photo'
  | 'verify_aadhaar'
  | 'add_credential'
  | 'verify_address'
  | 'collect_rating'
  | 'upload_credential_doc'
  | 'complete_profile';

interface NextAction {
  type:        NextActionType;
  title:       string;
  description: string;
  pointsGain:  number;
  icon:        string;   // emoji icon
  ctaLabel:    string;
  onPress:     () => void;
}

interface TrustNextActionCardProps {
  action:    NextAction;
  onDismiss: () => void;
  style?:    ViewStyle;
}

// ─── Component ────────────────────────────────────────────────────────────────
const TrustNextActionCard: React.FC<TrustNextActionCardProps> = ({
  action,
  onDismiss,
  style,
}) => {
  const slideAnim  = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 60, duration: 280, useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0, duration: 260, useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  };

  return (
    <Animated.View
      style={[
        styles.card,
        style,
        {
          transform: [{ translateX: slideAnim }],
          opacity:   opacityAnim,
        },
      ]}
    >
      {/* Left accent bar */}
      <View style={styles.accentBar} />

      {/* Icon */}
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>{action.icon}</Text>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>{action.title}</Text>
        <Text style={styles.desc} numberOfLines={2}>{action.description}</Text>

        {/* Points gain badge */}
        <View style={styles.pointsBadge}>
          <Text style={styles.pointsText}>+{action.pointsGain} pts potential</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={styles.cta}
          onPress={action.onPress}
          activeOpacity={0.82}
        >
          <Text style={styles.ctaText}>{action.ctaLabel}</Text>
        </TouchableOpacity>
      </View>

      {/* Dismiss ✕ */}
      <Pressable
        onPress={handleDismiss}
        style={styles.dismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.dismissIcon}>✕</Text>
      </Pressable>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    backgroundColor: IVORY,
    borderRadius:    16,
    padding:         14,
    borderWidth:     1,
    borderColor:     '#E8E0D4',
    shadowColor:     DEEP_INK,
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.06,
    shadowRadius:    8,
    elevation:       3,
    overflow:        'hidden',
  },
  accentBar: {
    position:     'absolute',
    left:         0,
    top:          0,
    bottom:       0,
    width:        4,
    backgroundColor: VERDIGRIS,
    borderTopLeftRadius:    16,
    borderBottomLeftRadius: 16,
  },
  iconWrap: {
    width:          44,
    height:         44,
    borderRadius:   22,
    backgroundColor: VERDIGRIS + '18',
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     8,
    marginRight:    10,
    flexShrink:     0,
  },
  icon: {
    fontSize: 22,
  },
  content: {
    flex: 1,
    gap:  4,
  },
  title: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      DEEP_INK,
  },
  desc: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      '#6B6560',
    lineHeight: 17,
  },
  pointsBadge: {
    alignSelf:        'flex-start',
    backgroundColor:  VERDIGRIS + '15',
    borderRadius:     8,
    paddingHorizontal: 7,
    paddingVertical:   2,
    marginTop:        2,
  },
  pointsText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   10,
    color:      VERDIGRIS,
  },
  cta: {
    alignSelf:        'flex-start',
    backgroundColor:  SAFFRON,
    borderRadius:     20,
    paddingHorizontal: 14,
    paddingVertical:   6,
    marginTop:        6,
  },
  ctaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    color:      '#FFFFFF',
  },
  dismiss: {
    padding:    4,
    marginLeft: 4,
  },
  dismissIcon: {
    fontSize:   13,
    color:      '#C4BCB4',
  },
});

export default TrustNextActionCard;

// ─── Helper: build action from missing signals ────────────────────────────────
export function buildNextAction(
  missingSignals: string[],
  onNavigate: (screen: string) => void,
): NextAction | null {
  if (missingSignals.includes('profile_photo')) {
    return {
      type: 'add_photo', title: 'Add a profile photo',
      description: 'Providers with photos get 3× more contacts',
      pointsGain: 5, icon: '📸', ctaLabel: 'Add photo',
      onPress: () => onNavigate('EditProfilePhoto'),
    };
  }
  if (missingSignals.includes('aadhaar_verified')) {
    return {
      type: 'verify_aadhaar', title: 'Verify with Aadhaar',
      description: 'DigiLocker link — 30 seconds, trusted by consumers',
      pointsGain: 25, icon: '🪪', ctaLabel: 'Verify now',
      onPress: () => onNavigate('AadhaarVerification'),
    };
  }
  if (missingSignals.includes('credential')) {
    return {
      type: 'add_credential', title: 'Add a credential',
      description: 'Licences, certificates, registrations boost trust',
      pointsGain: 15, icon: '🎓', ctaLabel: 'Add credential',
      onPress: () => onNavigate('AddCredential'),
    };
  }
  if (missingSignals.includes('geo_verified')) {
    return {
      type: 'verify_address', title: 'Verify your location',
      description: 'Shows consumers you operate in their area',
      pointsGain: 10, icon: '📍', ctaLabel: 'Verify location',
      onPress: () => onNavigate('GeoVerification'),
    };
  }
  return null;
}
