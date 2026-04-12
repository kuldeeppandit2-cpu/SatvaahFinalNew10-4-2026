/**
 * OpenRatingScreen.tsx
 * Community rating — NOT linked to a contact event.
 * ONLY available for Products and Establishments tabs.
 *
 * Rules:
 *  - Weight: 0.5× (shown to user)
 *  - Consumer must be OTP-verified and account ≥7 days old (enforced server-side)
 *  - Daily limits: Products=10/day, Establishments=8/day (from system_config)
 *  - Banner: "Community rating — not linked to a SatvAAh contact"
 *  - Daily indicator: "Products rated today: 3 of 10"
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
  RatingDimension,
  fetchDailyRatingUsage,
  submitOpenRating,
} from '../../api/rating.api';
import apiClient from '../../api/client';

// ─── Brand tokens ──────────────────────────────────────────────────────────────
const SAFFRON = '#C8691A';
const DEEP_INK = '#1C1C2E';
const IVORY = '#FAF7F0';
const VERDIGRIS = '#2E7D72';
const WARM_SAND = '#F0E4CC';
const TERRACOTTA = '#C0392B';

// ─── Types ────────────────────────────────────────────────────────────────────
type OpenRatingTab = 'products' | 'establishments';

type RootStackParamList = {
  OpenRating: {
    providerId: string;
    providerName: string;
    tab: OpenRatingTab;
    ratingDimensions?: RatingDimension[];
  };
};
type Props = NativeStackScreenProps<RootStackParamList, 'OpenRating'>;

// ─── Star component ────────────────────────────────────────────────────────────
function StarRow({
  value,
  size = 44,
  onChange,
}: {
  value: number;
  size?: number;
  onChange?: (v: number) => void;
}) {
  return (
        <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((s) => (
        <TouchableOpacity
          key={s}
          onPress={() => onChange?.(s)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Text style={{ fontSize: size, color: s <= value ? SAFFRON : '#D4C5A9' }}>★</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function OpenRatingScreen({ route, navigation }: Props) {
  const { provider_id, provider_name, tab, rating_dimensions = [] } = route.params;
  const insets = useSafeAreaInsets();

  const tabLabel = tab === 'products' ? 'Products' : 'Establishments';

  // ── State ──
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [dailyUsed, setDailyUsed] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(tab === 'products' ? 10 : 8);
  const [limitReached, setLimitReached] = useState(false);

  const [overallStars, setOverallStars] = useState(0);
  const [dimRatings, setDimRatings] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    rating_dimensions.forEach((d) => { init[d.key] = 0; });
    return init;
  });
  const [reviewText, setReviewText] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; s3Key?: string }[]>([]);
  const [photosUploading, setPhotosUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Load daily usage ──
  useEffect(() => {
    (async () => {
      try {
        const usage = await fetchDailyRatingUsage(tab);
        setDailyUsed(usage.used);
        setDailyLimit(usage.limit);
        setLimitReached(usage.used >= usage.limit);
      } catch {
        // Fail silently; server enforces limits
      } finally {
        setLoadingUsage(false);
      }
    })();
  }, [tab]);

  // ── Photo picker ──
  const pickPhoto = useCallback(async () => {
    if (photos.length >= 3) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, { uri: result.assets[0].uri }]);
    }
  }, [photos]);

  // ── Upload photos ──
  const uploadPhotos = useCallback(async (): Promise<string[]> => {
    if (photos.length === 0) return [];
    setPhotosUploading(true);
    const keys: string[] = [];
    try {
      for (const photo of photos) {
        if (photo.s3Key) { keys.push(photo.s3Key); continue; }
        const presignRes = await apiClient.post<{
          success: true;
          data: { upload_url: string; s3_key: string };
        }>('/api/v1/ratings/photo-upload-url', { content_type: 'image/jpeg', context: 'rating' });
        const { upload_url, s3_key } = presignRes.data.data;
        const blob = await fetch(photo.uri).then((r) => r.blob());
        await fetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
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
    if (overallStars === 0) {
      Alert.alert('Rating required', 'Please select a star rating before submitting.');
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

      const result = await submitOpenRating({
        providerId: provider_id,
        tab,
        overallStars: overallStars,
        dimensions: dimArray.length > 0 ? dimArray : undefined,
        reviewText: reviewText.trim() || undefined,
        photoKeys: photoKeys.length > 0 ? photoKeys : undefined,
      });

      Alert.alert(
        'Rating submitted',
        `Thank you! You've rated ${result.daily_used} of ${result.daily_limit} ${tabLabel} today.`,
        [{ text: 'Done', onPress: () => navigation.goBack() }],
      );
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? 'Could not submit. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [overallStars, reviewText, dimRatings, uploadPhotos, provider_id, tab, tabLabel, navigation]);

  // ── Daily limit reached ──
  if (!loadingUsage && limitReached) {
    return (
      <View style={[styles.center, { backgroundColor: IVORY, paddingHorizontal: 32 }]}>
        <Text style={styles.limitTitle}>Daily limit reached</Text>
        <Text style={styles.limitBody}>
          You've rated {dailyUsed} of {dailyLimit} {tabLabel} today.{'\n'}Come back tomorrow!
        </Text>
      </View>
    );
  }

  const charLeft = 500 - reviewText.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>
    <ScreenHeader title="Rate Your Experience" onBack={() => navigation.goBack()} />
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: IVORY }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Community rating banner ── */}
        <View style={styles.communityBanner}>
          <Text style={styles.communityIcon}>🌐</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.communityTitle}>Community Rating</Text>
            <Text style={styles.communitySubtitle}>
              Not linked to a SatvAAh contact · Contributes 0.5× weight
            </Text>
          </View>
        </View>

        {/* ── Daily usage indicator ── */}
        <View style={styles.usageRow}>
          {loadingUsage ? (
            <ActivityIndicator size="small" color={SAFFRON} />
          ) : (
            <>
              <View
                style={[
                  styles.usagePill,
                  { backgroundColor: dailyUsed >= dailyLimit ? '#FFEBEE' : '#E8F5E9' },
                ]}
              >
                <Text
                  style={[
                    styles.usageText,
                    { color: dailyUsed >= dailyLimit ? TERRACOTTA : VERDIGRIS },
                  ]}
                >
                  {tabLabel} rated today: {dailyUsed} of {dailyLimit}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* ── Provider header ── */}
        <View style={styles.header}>
          <Text style={styles.providerName}>{provider_name}</Text>
          <Text style={styles.subtitle}>Share your experience</Text>
        </View>

        {/* ── Overall stars ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Overall Rating</Text>
          <StarRow value={overallStars} size={48} onChange={setOverallStars} />
          {overallStars > 0 && (
            <Text style={styles.starHint}>
              {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][overallStars]}
            </Text>
          )}
        </View>

        {/* ── Dimension ratings ── */}
        {rating_dimensions.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Detailed Ratings</Text>
            {rating_dimensions.map((dim) => (
              <View key={dim.key} style={styles.dimRow}>
                <Text style={styles.dimLabel}>
                  {dim.icon ? `${dim.icon}  ` : ''}{dim.label}
                </Text>
                <StarRow
                  value={dimRatings[dim.key] ?? 0}
                  size={26}
                  onChange={(v) => setDimRatings((p) => ({ ...p, [dim.key]: v }))}
                />
              </View>
            ))}
          </View>
        )}

        {/* ── Review text ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            Write a Review <Text style={styles.optional}>(optional)</Text>
          </Text>
          <TextInput
            style={styles.textInput}
            placeholder="Share what you liked or didn't like..."
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
            Photos <Text style={styles.optional}>(optional, max 3)</Text>
          </Text>
          <View style={styles.photoRow}>
            {photos.map((p, idx) => (
              <View key={idx} style={styles.photoThumb}>
                <Image source={{ uri: p.uri }} style={styles.photoImg} />
                <Pressable
                  style={styles.removePhoto}
                  onPress={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                >
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

        {/* ── Submit ── */}
        <TouchableOpacity
          style={[styles.submitBtn, (submitting || photosUploading) && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={submitting || photosUploading}
          activeOpacity={0.85}
        >
          {submittin
            <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>g || photosUploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Submit Community Rating</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
            </SafeAreaView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, backgroundColor: IVORY },

  communityBanner: {
    backgroundColor: '#EFF8F7',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: VERDIGRIS,
  },
  communityIcon: { fontSize: 22 },
  communityTitle: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: VERDIGRIS,
  },
  communitySubtitle: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#5A8C87',
    marginTop: 2,
  },

  usageRow: { alignItems: 'flex-start', marginBottom: 16 },
  usagePill: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  usageText: { fontSize: 13, fontFamily: 'PlusJakartaSans-Medium' },

  header: { marginBottom: 20, alignItems: 'center' },
  providerName: {
    fontSize: 20,
    fontFamily: 'PlusJakartaSans-Bold',
    color: DEEP_INK,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
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
    minHeight: 90,
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

  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { fontSize: 14, fontFamily: 'PlusJakartaSans-Regular', color: '#9E9E9E' },

  limitTitle: {
    fontSize: 20,
    fontFamily: 'PlusJakartaSans-Bold',
    color: DEEP_INK,
    marginBottom: 12,
    textAlign: 'center',
  },
  limitBody: {
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
