/**
 * ProviderRatesConsumerScreen.tsx
 * Phase 24 — Provider Verification
 *
 * Triggered 24h after lead accepted (contact_event status = accepted).
 * Consumer rates the provider: 5 stars + optional flag chips.
 *
 * Flag chips: no-show | abusive | fake | didn't pay
 * Rating eligibility check: GET /rating/v1/eligibility/{contactEventId}
 * Submit: POST /rating/v1/submit
 *
 * V010 ratings: provider_id, consumer_id, contact_event_id NULLABLE,
 *               overall_stars, weight_type, weight_value, moderation_status
 * V011 daily_rating_usage: consumer_id, tab, date — UNIQUE. Enforces daily limits.
 * Moderation: 10-step server-side process. Burst detection.
 *
 * Route params:
 *   contactEventId: string
 *   providerName: string
 *   providerCategory: string
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  TextInput,
  Alert,
  ActivityIndicator,
  StatusBar,
  Keyboard,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../../stores/auth.store';
import { apiClient } from '../../api/client';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { ProviderStackParamList } from '../../navigation/ProviderStack';

// ─── Types ────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<ProviderStackParamList, 'ProviderRatesConsumer'>;
type RoutePropType = RouteProp<ProviderStackParamList, 'ProviderRatesConsumer'>;

type FlagType = 'no_show' | 'abusive' | 'fake' | 'didnt_pay';

interface EligibilityData {
  eligible: boolean;
  reason?: string; // 'already_rated' | 'too_early' | 'expired' | 'contact_not_accepted'
  providerName: string;
  provider_category: string;
  accepted_at: string;
}

interface RatingSubmitPayload {
  contactEventId: string;
  overallStars: number;
  flags: FlagType[];
  reviewText?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FLAG_DEFINITIONS: { id: FlagType; label: string; icon: string; color: string }[] = [
  { id: 'no_show', label: 'No-show', icon: '🚫', color: '#E74C3C' },
  { id: 'abusive', label: 'Abusive behaviour', icon: '⚠️', color: '#E67E22' },
  { id: 'fake', label: 'Fake profile', icon: '🎭', color: '#9B59B6' },
  { id: 'didnt_pay', label: "Didn't pay", icon: '💸', color: '#C0392B' },
];

const STAR_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Below average',
  3: 'Average',
  4: 'Good',
  5: 'Excellent',
};

// ─── Star selector ────────────────────────────────────────────────────────────

interface StarSelectorProps {
  value: number;
  onChange: (stars: number) => void;
}

const StarSelector: React.FC<StarSelectorProps> = ({ value, onChange }) => {
  const scaleAnims = useRef(Array.from({ length: 5 }, () => new Animated.Value(1))).current;

  const handlePress = (star: number) => {
    onChange(star);
    Animated.sequence([
      Animated.spring(scaleAnims[star - 1], {
        toValue: 1.35,
        friction: 4,
        tension: 180,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnims[star - 1], {
        toValue: 1,
        friction: 6,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <View style={starStyles.container}>
      <View style={starStyles.stars}>
        {[1, 2, 3, 4, 5].map(star => (
          <Animated.View
            key={star}
            style={{ transform: [{ scale: scaleAnims[star - 1] }] }}
          >
            <TouchableOpacity
              onPress={() => handlePress(star)}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              activeOpacity={0.8}
            >
              <Text style={[starStyles.star, { opacity: value >= star ? 1 : 0.25 }]}>
                ★
              </Text>
            </TouchableOpacity>
          </Animated.View>
        ))}
      </View>
      {value > 0 && (
        <Text style={starStyles.label}>{STAR_LABELS[value]}</Text>
      )}
    </View>
  );
};

const starStyles = StyleSheet.create({
  container: { alignItems: 'center', gap: SPACING.sm },
  stars: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  star: {
    fontSize: 44,
    color: COLORS.saffron,
  },
  label: {
    fontFamily: FONTS.semiBold,
    fontSize: 16,
    color: COLORS.deepInk,
  },
});

// ─── Flag chip ────────────────────────────────────────────────────────────────

interface FlagChipProps {
  flag: (typeof FLAG_DEFINITIONS)[0];
  selected: boolean;
  onToggle: () => void;
}

const FlagChip: React.FC<FlagChipProps> = ({ flag, selected, onToggle }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 0.93, useNativeDriver: true, friction: 8 }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 8 }),
    ]).start();
    onToggle();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          chipStyles.chip,
          selected && { backgroundColor: `${flag.color}18`, borderColor: flag.color },
        ]}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        <Text style={chipStyles.icon}>{flag.icon}</Text>
        <Text style={[chipStyles.label, selected && { color: flag.color, fontFamily: FONTS.semiBold }]}>
          {flag.label}
        </Text>
        {selected && (
          <Text style={[chipStyles.checkmark, { color: flag.color }]}>✓</Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#E8E8EF',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  icon: { fontSize: 16 },
  label: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    color: COLORS.deepInk,
  },
  checkmark: {
    fontFamily: FONTS.bold,
    fontSize: 13,
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export const ProviderRatesConsumerScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RoutePropType>();
  const { accessToken } = useAuthStore();

  const { contactEventId, providerName: routeProviderName, providerCategory } = route.params;

  const [eligibility, setEligibility] = useState<EligibilityData | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);

  const [stars, setStars] = useState(0);
  const [flags, setFlags] = useState<Set<FlagType>>(new Set());
  const [reviewText, setReviewText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Animations
  const headerFade = useRef(new Animated.Value(0)).current;
  const contentSlide = useRef(new Animated.Value(30)).current;
  const contentFade = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0.6)).current;
  const successFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    checkEligibility();
  }, []);

  const checkEligibility = async () => {
    setEligibilityLoading(true);
    try {
      const res = await apiClient.get(
        `/api/v1/consumer-ratings/eligibility/${contactEventId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setEligibility(res.data.data);
      if (res.data.data?.eligible) {
        playEntryAnimation();
      }
    } catch (err: any) {
      // If eligibility check fails, assume eligible (server will reject on submit if not)
      setEligibility({
        eligible: true,
        providerName: routeProviderName,
        provider_category: providerCategory,
        accepted_at: new Date().toISOString(),
      });
      playEntryAnimation();
    } finally {
      setEligibilityLoading(false);
    }
  };

  const playEntryAnimation = () => {
    Animated.parallel([
      Animated.timing(headerFade, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(contentFade, {
        toValue: 1,
        duration: 500,
        delay: 200,
        useNativeDriver: true,
      }),
      Animated.timing(contentSlide, {
        toValue: 0,
        duration: 450,
        delay: 200,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const toggleFlag = (flagId: FlagType) => {
    setFlags(prev => {
      const next = new Set(prev);
      if (next.has(flagId)) {
        next.delete(flagId);
      } else {
        next.add(flagId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (stars === 0) {
      Alert.alert('Please select a rating', 'Tap the stars to rate your experience with this provider.');
      return;
    }

    const hasNegativeFlags = flags.size > 0;
    const isLowStars = stars <= 2;

    // If flagging, confirm intent
    if (hasNegativeFlags || isLowStars) {
      Alert.alert(
        'Confirm your rating',
        `You're giving ${stars} star${stars === 1 ? '' : 's'}${
          hasNegativeFlags
            ? ` and flagging: ${Array.from(flags)
                .map(f => FLAG_DEFINITIONS.find(d => d.id === f)?.label)
                .join(', ')}`
            : ''
        }. This helps us maintain trust on the platform.`,
        [
          { text: 'Go back', style: 'cancel' },
          { text: 'Submit rating', onPress: submitRating },
        ]
      );
    } else {
      submitRating();
    }
  };

  const submitRating = async () => {
    setSubmitting(true);
    Keyboard.dismiss();

    const payload: RatingSubmitPayload = {
      contactEventId: contactEventId,
      overallStars: stars,
      flags: Array.from(flags),
    };

    if (reviewText.trim()) {
      payload.reviewText = reviewText.trim();
    }

    try {
      await apiClient.post('/api/v1/consumer-ratings', payload, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      setSubmitted(true);
      playSuccessAnimation();
    } catch (err: any) {
      const code = err?.response?.data?.code;

      if (code === 'ALREADY_RATED') {
        Alert.alert(
          'Already rated',
          'You have already rated this provider for this contact.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } else if (code === 'DAILY_LIMIT_REACHED') {
        Alert.alert(
          'Daily limit reached',
          'You have reached the maximum number of ratings for today. Please try again tomorrow.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } else {
        Alert.alert(
          'Rating failed',
          err?.response?.data?.message || 'Could not submit your rating. Please try again.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const playSuccessAnimation = () => {
    Animated.parallel([
      Animated.spring(successScale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }),
      Animated.timing(successFade, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // ─── Loading state ─────────────────────────────────────────────────────────

  if (eligibilityLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={COLORS.verdigris} />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Not eligible ──────────────────────────────────────────────────────────

  if (eligibility && !eligibility.eligible) {
    const reasonMessages: Record<string, string> = {
      already_rated: 'You have already rated this provider.',
      too_early: 'You can rate this provider 24 hours after the contact was accepted.',
      expired: 'The rating window for this contact has expired.',
      contact_not_accepted: 'This contact was not accepted by the provider.',
    };
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.navBack}>←</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>Rate Provider</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.ineligibleCenter}>
          <Text style={styles.ineligibleIcon}>🔒</Text>
          <Text style={styles.ineligibleTitle}>Rating unavailable</Text>
          <Text style={styles.ineligibleBody}>
            {reasonMessages[eligibility.reason ?? ''] ||
              'This rating is not available right now.'}
          </Text>
          <TouchableOpacity
            style={styles.ineligibleBackBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.ineligibleBackBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Success state ─────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <Animated.View
          style={[
            styles.successContainer,
            { opacity: successFade, transform: [{ scale: successScale }] },
          ]}
        >
          <Text style={styles.successIcon}>
            {stars >= 4 ? '🌟' : stars >= 3 ? '✅' : '📋'}
          </Text>
          <Text style={styles.successTitle}>Rating submitted</Text>
          <Text style={styles.successBody}>
            {stars >= 4
              ? `Thank you! Your positive review helps ${eligibility?.providerName || routeProviderName} build their trust profile.`
              : `Thank you for your feedback. It helps us maintain quality on SatvAAh.`}
          </Text>
          {stars >= 4 && (
            <View style={styles.successTrustNote}>
              <Text style={styles.successTrustNoteText}>
                ⭐ This rating contributes to their trust score
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.successDoneBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.successDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // ─── Main rating UI ────────────────────────────────────────────────────────

  const providerName = eligibility?.providerName || routeProviderName;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />

      {/* Nav */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.navBack}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Rate Provider</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <Animated.View style={[styles.headerCard, { opacity: headerFade }]}>
            <View style={styles.providerAvatarPlaceholder}>
              <Text style={styles.providerAvatarIcon}>👤</Text>
            </View>
            <Text style={styles.providerName}>{providerName}</Text>
            <Text style={styles.providerCategory}>{providerCategory}</Text>
            <Text style={styles.headerPrompt}>
              How was your experience?
            </Text>
          </Animated.View>

          {/* Rating form */}
          <Animated.View
            style={[
              styles.ratingCard,
              {
                opacity: contentFade,
                transform: [{ translateY: contentSlide }],
              },
            ]}
          >
            {/* Star selector */}
            <Text style={styles.ratingLabel}>Overall rating</Text>
            <StarSelector value={stars} onChange={setStars} />

            {/* Review text */}
            {stars > 0 && (
              <View style={styles.reviewTextSection}>
                <Text style={styles.reviewTextLabel}>
                  Write a review{' '}
                  <Text style={styles.reviewTextOptional}>(optional)</Text>
                </Text>
                <TextInput
                  style={styles.reviewTextInput}
                  value={reviewText}
                  onChangeText={setReviewText}
                  placeholder={
                    stars >= 4
                      ? `What did ${providerName} do well?`
                      : `What could ${providerName} improve?`
                  }
                  placeholderTextColor="#CCCCDD"
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  textAlignVertical="top"
                />
                <Text style={styles.reviewCharCount}>{reviewText.length}/500</Text>
              </View>
            )}

            {/* Flag chips — only shown when 1 or 2 stars */}
            {stars > 0 && stars <= 2 && (
              <View style={styles.flagSection}>
                <Text style={styles.flagTitle}>Flag an issue (optional)</Text>
                <Text style={styles.flagSubtitle}>
                  Flags are reviewed by our moderation team before affecting trust scores.
                </Text>
                <View style={styles.flagChips}>
                  {FLAG_DEFINITIONS.map(flag => (
                    <FlagChip
                      key={flag.id}
                      flag={flag}
                      selected={flags.has(flag.id)}
                      onToggle={() => toggleFlag(flag.id)}
                    />
                  ))}
                </View>
              </View>
            )}
          </Animated.View>

          {/* Trust impact note */}
          {stars >= 4 && (
            <Animated.View style={[styles.trustImpactCard, { opacity: contentFade }]}>
              <Text style={styles.trustImpactIcon}>⭐</Text>
              <Text style={styles.trustImpactText}>
                Your positive rating directly contributes to{' '}
                <Text style={styles.trustImpactBold}>{providerName}'s</Text> trust score
                on SatvAAh. Genuine reviews help consumers make better decisions.
              </Text>
            </Animated.View>
          )}

          {/* Moderation note */}
          <View style={styles.moderationNote}>
            <Text style={styles.moderationNoteText}>
              All ratings are reviewed by SatvAAh's moderation team before they affect
              trust scores. Ratings submitted in bad faith may be removed.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Submit CTA — sticky bottom */}
      <Animated.View style={[styles.submitContainer, { opacity: contentFade }]}>
        <TouchableOpacity
          style={[
            styles.submitBtn,
            stars === 0 && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={stars === 0 || submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>
              {stars === 0 ? 'Select a rating to continue' : `Submit ${stars}-star rating`}
            </Text>
          )}
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.ivory },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.ivory,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8EF',
  },
  navBack: { fontFamily: FONTS.semiBold, fontSize: 20, color: COLORS.deepInk },
  navTitle: { fontFamily: FONTS.bold, fontSize: 17, color: COLORS.deepInk },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: 120, // room for sticky submit btn
  },

  // Header card
  headerCard: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
    paddingVertical: SPACING.lg,
  },
  providerAvatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.warmSand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  providerAvatarIcon: { fontSize: 36 },
  providerName: {
    fontFamily: FONTS.bold,
    fontSize: 22,
    color: COLORS.deepInk,
    textAlign: 'center',
    marginBottom: 4,
  },
  providerCategory: {
    fontFamily: FONTS.medium,
    fontSize: 14,
    color: '#8888A0',
    textAlign: 'center',
    textTransform: 'capitalize',
    marginBottom: SPACING.md,
  },
  headerPrompt: {
    fontFamily: FONTS.regular,
    fontSize: 15,
    color: '#5A5A6E',
  },

  // Rating card
  ratingCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
    gap: SPACING.lg,
  },
  ratingLabel: {
    fontFamily: FONTS.semiBold,
    fontSize: 15,
    color: COLORS.deepInk,
    textAlign: 'center',
  },

  // Review text
  reviewTextSection: { gap: SPACING.xs },
  reviewTextLabel: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.deepInk,
  },
  reviewTextOptional: {
    fontFamily: FONTS.regular,
    color: '#AAAABC',
    fontSize: 13,
  },
  reviewTextInput: {
    backgroundColor: COLORS.ivory,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: '#E8E8EF',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontFamily: FONTS.regular,
    fontSize: 15,
    color: COLORS.deepInk,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  reviewCharCount: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#CCCCDD',
    textAlign: 'right',
  },

  // Flags
  flagSection: { gap: SPACING.sm },
  flagTitle: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.deepInk,
  },
  flagSubtitle: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: '#8888A0',
    lineHeight: 17,
  },
  flagChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },

  // Trust impact
  trustImpactCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    backgroundColor: '#FFF8EE',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.saffron,
  },
  trustImpactIcon: { fontSize: 18, flexShrink: 0 },
  trustImpactText: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#5A5A6E',
    lineHeight: 19,
    flex: 1,
  },
  trustImpactBold: { fontFamily: FONTS.semiBold, color: COLORS.deepInk },

  // Moderation note
  moderationNote: {
    paddingVertical: SPACING.md,
  },
  moderationNoteText: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: '#AAAABC',
    textAlign: 'center',
    lineHeight: 18,
  },

  // Submit button
  submitContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.lg,
    paddingBottom: Platform.OS === 'ios' ? 34 : SPACING.lg,
    paddingTop: SPACING.md,
    backgroundColor: 'rgba(250, 247, 240, 0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E8EF',
  },
  submitBtn: {
    backgroundColor: COLORS.verdigris,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md + 4,
    alignItems: 'center',
    shadowColor: COLORS.verdigris,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  submitBtnDisabled: {
    backgroundColor: '#C8C8D8',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    color: '#fff',
  },

  // Ineligible state
  ineligibleCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  ineligibleIcon: { fontSize: 56, marginBottom: SPACING.lg },
  ineligibleTitle: {
    fontFamily: FONTS.bold,
    fontSize: 22,
    color: COLORS.deepInk,
    marginBottom: SPACING.sm,
  },
  ineligibleBody: {
    fontFamily: FONTS.regular,
    fontSize: 15,
    color: '#5A5A6E',
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: SPACING.xl,
  },
  ineligibleBackBtn: {
    backgroundColor: COLORS.deepInk,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  ineligibleBackBtnText: {
    fontFamily: FONTS.semiBold,
    fontSize: 16,
    color: '#fff',
  },

  // Success state
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  successIcon: { fontSize: 64, marginBottom: SPACING.lg },
  successTitle: {
    fontFamily: FONTS.bold,
    fontSize: 26,
    color: COLORS.deepInk,
    marginBottom: SPACING.sm,
  },
  successBody: {
    fontFamily: FONTS.regular,
    fontSize: 15,
    color: '#5A5A6E',
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: SPACING.lg,
  },
  successTrustNote: {
    backgroundColor: '#E8F5F3',
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  successTrustNoteText: {
    fontFamily: FONTS.semiBold,
    fontSize: 13,
    color: COLORS.verdigris,
  },
  successDoneBtn: {
    backgroundColor: COLORS.deepInk,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md + 4,
    paddingHorizontal: SPACING.xl * 2,
  },
  successDoneBtnText: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    color: '#fff',
  },
});

export default ProviderRatesConsumerScreen;
