/**
 * RateProviderScreen.tsx
 * Triggered by FCM push 24 hours after a contact_event is accepted.
 *
 * Features:
 *  - Eligibility gate (GET /api/v1/ratings/eligibility/:id)
 *  - 5 large Saffron stars (overall rating)
 *  - Dimension ratings from taxonomy_node.ratingDimensions JSONB
 *  - Optional review text (max 500 chars) + up to 3 photos
 *  - Expiry nudge after 3 skips: "This rating expires in 24 hours"
 *  - +2 bonus leads shown on success
 *  - Photo upload to S3 via presigned URL before submit
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 ActivityIndicator,
 Alert,
 Image,
 KeyboardAvoidingView,
 Platform,
 Pressable,
 ScrollView,
 StyleSheet,
 Text,
 TextInput,
 TouchableOpacity,
 View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DimensionRating,
  RatingEligibility,
  fetchRatingEligibility,
  submitVerifiedRating,
} from '../../api/rating.api';
import { apiClient } from '../../api/client';

// ─── Brand tokens ──────────────────────────────────────────────────────────────
const SAFFRON = '#C8691A';
const DEEP_INK = '#1C1C2E';
const IVORY = '#FAF7F0';
const VERDIGRIS = '#2E7D72';
const WARM_SAND = '#F0E4CC';
const TERRACOTTA = '#C0392B';

// ─── Navigation param types ────────────────────────────────────────────────────
type RootStackParamList = {
  RateProvider: { provider_id: string };
  // add other routes as needed
};
type Props = NativeStackScreenProps<RootStackParamList, 'RateProvider'>;

// ─── Star component ────────────────────────────────────────────────────────────
interface StarRowProps {
  count: 5;
  value: number;
  size?: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
}

function StarRow({ value, size = 48, onChange, readonly = false }: StarRowProps) {
  return (
        <ScreenHeader title="Rate Provider" onBack={() => navigation.goBack()} />
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((s) => (
        <TouchableOpacity
          key={s}
          disabled={readonly}
          onPress={() => onChange?.(s)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Text style={[styles.star, { fontSize: size, color: s <= value ? SAFFRON : '#D4C5A9' }]}>
            ★
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Dimension row ─────────────────────────────────────────────────────────────
interface DimRowProps {
  label: string;
  icon?: string;
  value: number;
  onChange: (v: number) => void;
}

function DimensionRow({ label, icon, value, onChange }: DimRowProps) {
  return (
    <View style={styles.dimRow}>
      <Text style={styles.dimLabel}>
        {icon ? `${icon}  ` : ''}{label}
      </Text>
      <StarRow count={5} value={value} size={28} onChange={onChange} />
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function RateProviderScreen({ route, navigation }: Props) {
  const { providerId: provider_id } = route.params;
  const insets = useSafeAreaInsets();

  // ── State ──
  const [eligibility, setEligibility] = useState<RatingEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ineligibleReason, setIneligibleReason] = useState<string | null>(null);

  const [overallStars, setOverallStars] = useState(0);
  const [dimRatings, setDimRatings] = useState<Record<string, number>>({});
  const [reviewText, setReviewText] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; s3Key?: string }[]>([]);
  const [photosUploading, setPhotosUploading] = useState(false);

  // ── Load eligibility ──
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchRatingEligibility(provider_id);
        if (!data.eligible) {
          setIneligibleReason(data.reason ?? 'You are not eligible to rate this provider.');
        } else {
          setEligibility(data);
          // Pre-initialise dimension ratings to 0
          const initial: Record<string, number> = {};
          (data.ratingDimensions ?? []).forEach((d) => { initial[d.key] = 0; });
          setDimRatings(initial);
        }
      } catch {
        setIneligibleReason('Could not check rating eligibility. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [provider_id]);

  // ── Dimension change ──
  const handleDimChange = useCallback((key: string, value: number) => {
    setDimRatings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Photo picker ──
  const pickPhoto = useCallback(async () => {
    if (photos.length >= 3) {
      Alert.alert('Limit reached', 'You can add up to 3 photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, { uri: result.assets[0].uri }]);
    }
  }, [photos]);

  const removePhoto = useCallback((idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ── Upload photos to S3 via presigned URL ──
  const uploadPhotos = useCallback(async (): Promise<string[]> => {
    if (photos.length === 0) return [];
    setPhotosUploading(true);
    const keys: string[] = [];
    try {
      for (const photo of photos) {
        if (photo.s3Key) {
          keys.push(photo.s3Key);
          continue;
        }
        // 1. Get presigned upload URL
        const presignRes = await apiClient.post<{
          success: true;
          data: { upload_url: string; s3_key: string };
        }>('/api/v1/ratings/photo-upload-url', {
          content_type: 'image/jpeg',
          context: 'rating',
        });
        const { upload_url, s3_key } = presignRes.data.data;

        // 2. Upload to S3
        const blob = await fetch(photo.uri).then((r) => r.blob());
        await fetch(upload_url, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': 'image/jpeg' },
        });
        keys.push(s3_key);
      }
    } catch {
      Alert.alert('Photo upload failed', 'Could not upload photos. Your rating will be submitted without them.');
      return keys; // return any keys already uploaded
    } finally {
      setPhotosUploading(false);
    }
    return keys;
  }, [photos]);

  // ── Submit ──
  const handleSubmit = useCallback(async () => {
    if (!eligibility) return;
    if (overallStars === 0) {
      Alert.alert('Rating required', 'Please tap a star to rate this provider.');
      return;
    }
    if (reviewText.length > 500) {
      Alert.alert('Too long', 'Review must be 500 characters or fewer.');
      return;
    }

    setSubmitting(true);
    try {
      const photoKeys = await uploadPhotos();

      const dimArray: DimensionRating[] = Object.entries(dimRatings)
        .filter(([, v]) => v > 0)
        .map(([key, stars]) => ({ key, stars }));

      const result = await submitVerifiedRating({
        providerId: eligibility.providerId,
        contactEventId: eligibility.contactEventId!,
        overallStars: overallStars,
        dimension_ratings: dimArray.length > 0 ? dimArray : undefined,
        text: reviewText.trim() || undefined,
        photo_keys: photoKeys.length > 0 ? photoKeys : undefined,
      });

      // Show success then go back
      Alert.alert(
        '🙏 Thank you!',
        `Your rating was submitted.\n+${result.bonusLeadsGranted} bonus leads added to your account.`,
        [{ text: 'Done', onPress: () => navigation.goBack() }],
      );
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? 'Something went wrong. Please try again.';
      Alert.alert('Could not submit', msg);
    } finally {
      setSubmitting(false);
    }
  }, [eligibility, overallStars, dimRatings, reviewText, uploadPhotos, navigation]);

  // ── Render states ──
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: IVORY }]}>
        <ActivityIndicator size="large" color={SAFFRON} />
      </View>
    );
  }

  if (ineligibleReason) {
    return (
      <View style={[styles.center, { backgroundColor: IVORY, paddingHorizontal: 32 }]}>
        <Text style={styles.ineligibleTitle}>Rating Unavailable</Text>
        <Text style={styles.ineligibleBody}>{ineligibleReason}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!eligibility) return null;

  const isExpiring = eligibility.skipCount >= 3;
  const charLeft = 500 - reviewText.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>

    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: IVORY }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Expiry nudge ── */}
        {isExpiring && (
          <View style={styles.expiryBanner}>
            <Text style={styles.expiryText}>⏰ This rating expires in 24 hours</Text>
          </View>
        )}

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.providerName}>{eligibility.providerName}</Text>
          <Text style={styles.subtitle}>How was your experience?</Text>
        </View>

        {/* ── Overall stars ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Overall Rating</Text>
          <StarRow count={5} value={overallStars} size={52} onChange={setOverallStars} />
          {overallStars > 0 && (
            <Text style={styles.starHint}>
              {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][overallStars]}
            </Text>
          )}
        </View>

        {/* ── Dimension ratings ── */}
        {eligibility.ratingDimensions.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Detailed Ratings</Text>
            {eligibility.ratingDimensions.map((dim) => (
              <DimensionRow
                key={dim.key}
                label={dim.label}
                icon={dim.icon}
                value={dimRatings[dim.key] ?? 0}
                onChange={(v) => handleDimChange(dim.key, v)}
              />
            ))}
          </View>
        )}

        {/* ── Review text ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Write a Review <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.textInput}
            placeholder="Share your experience to help others..."
            placeholderTextColor="#9E9E9E"
            multiline
            maxLength={500}
            value={reviewText}
            onChangeText={setReviewText}
            textAlignVertical="top"
          />
          <Text style={[styles.charCount, charLeft < 50 && { color: TERRACOTTA }]}>
            {charLeft} characters remaining
          </Text>
        </View>

        {/* ── Photos ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            Add Photos <Text style={styles.optional}>(optional, max 3)</Text>
          </Text>
          <View style={styles.photoRow}>
            {photos.map((p, idx) => (
              <View key={idx} style={styles.photoThumb}>
                <Image source={{ uri: p.uri }} style={styles.photoImg} />
                <Pressable style={styles.removePhoto} onPress={() => removePhoto(idx)}>
                  <Text style={styles.removePhotoText}>✕</Text>
                </Pressable>
              </View>
            ))}
            {photos.length < 3 && (
              <TouchableOpacity style={styles.addPhoto} onPress={pickPhoto}>
                <Text style={styles.addPhotoIcon}>+</Text>
                <Text style={styles.addPhotoLabel}>Photo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Bonus leads nudge ── */}
        <View style={styles.bonusBadge}>
          <Text style={styles.bonusText}>
            ✨ Earn +{eligibility.ratingBonusLeads} bonus leads for submitting
          </Text>
        </View>

        {/* ── Submit button ── */}
        <TouchableOpacity
          style={[styles.submitBtn, (submitting || photosUploading) && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={submitting || photosUploading}
          activeOpacity={0.85}
        >
          {submitting || photosUploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Submit Rating</Text>
          )}
        </TouchableOpacity>

        {/* ── Skip link ── */}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, backgroundColor: IVORY },

  expiryBanner: {
    backgroundColor: '#FFF3E0',
    borderLeftWidth: 4,
    borderLeftColor: SAFFRON,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  expiryText: { fontSize: 13, color: DEEP_INK, fontFamily: 'PlusJakartaSans-Medium' },

  header: { marginBottom: 20, alignItems: 'center' },
  providerName: {
    fontSize: 22,
    fontFamily: 'PlusJakartaSans-Bold',
    color: DEEP_INK,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    marginTop: 4,
  },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionLabel: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: DEEP_INK,
    marginBottom: 14,
  },
  optional: { fontSize: 13, fontFamily: 'PlusJakartaSans-Regular', color: '#9E9E9E' },

  starRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  star: { lineHeight: undefined },
  starHint: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Medium',
    color: SAFFRON,
  },

  dimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EBEBEB',
  },
  dimLabel: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: DEEP_INK,
    flex: 1,
    marginRight: 8,
  },

  textInput: {
    borderWidth: 1,
    borderColor: '#E0D8CC',
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: DEEP_INK,
    backgroundColor: WARM_SAND,
  },
  charCount: {
    textAlign: 'right',
    marginTop: 6,
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9E9E9E',
  },

  photoRow: { flexDirection: 'row', gap: 12 },
  photoThumb: { position: 'relative', width: 72, height: 72 },
  photoImg: { width: 72, height: 72, borderRadius: 10 },
  removePhoto: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: TERRACOTTA,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhotoText: { color: '#fff', fontSize: 10, fontFamily: 'PlusJakartaSans-Bold' },
  addPhoto: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D4C5A9',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WARM_SAND,
  },
  addPhotoIcon: { fontSize: 24, color: '#9E9E9E' },
  addPhotoLabel: { fontSize: 11, color: '#9E9E9E', fontFamily: 'PlusJakartaSans-Regular' },

  bonusBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  bonusText: { fontSize: 14, fontFamily: 'PlusJakartaSans-Medium', color: VERDIGRIS },

  submitBtn: {
    backgroundColor: SAFFRON,
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { fontSize: 16, fontFamily: 'PlusJakartaSans-Bold', color: '#fff' },

  skipBtn: { alignItems: 'center', paddingVertical: 8 },
  skipText: { fontSize: 14, fontFamily: 'PlusJakartaSans-Regular', color: '#9E9E9E' },

  ineligibleTitle: {
    fontSize: 20,
    fontFamily: 'PlusJakartaSans-Bold',
    color: DEEP_INK,
    marginBottom: 12,
    textAlign: 'center',
  },
  ineligibleBody: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    textAlign: 'center',
    lineHeight: 22,
  },
  backBtn: {
    marginTop: 24,
    backgroundColor: SAFFRON,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  backBtnText: { fontSize: 15, fontFamily: 'PlusJakartaSans-SemiBold', color: '#fff' },
});
