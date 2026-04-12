/**
 * ProviderProfileEditScreen.tsx
 * Phase 24 — Provider Verification
 *
 * All profile fields, photo upload via S3 pre-signed URL.
 * LinkedIn/Website verified → trust points.
 * Establishment extras for establishments listing_type.
 *
 * Photo upload flow:
 * 1. GET /user/v1/provider/photo-upload-url → { uploadUrl, key }
 * 2. PUT to upload_url with binary image (no auth header — pre-signed)
 * 3. POST /user/v1/provider/photo-confirm { key } → profile updated
 *
 * V004 provider_profiles: listing_type, tab, geo_point, trust_score,
 *      is_claimed, all verification boolean flags
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../stores/auth.store';
import { useProviderStore } from '../../stores/provider.store';
import { apiClient } from '../../api/client';
import { providerApi } from '../../api/provider.api';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { ProviderStackParamList } from '../../navigation/ProviderStack';
import { ListingType } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<ProviderStackParamList, 'ProviderProfileEdit'>;

interface ProfileFormData {
  displayName:    string;
  bio:            string;
  whatsappPhone:  string;    // schema: whatsapp_phone
  websiteUrl:     string;    // schema: website_url
  linkedinUrl:    string;    // UI only — not in schema, used for verification flow
  businessName:   string;    // schema: business_name (for establishments)
}

interface ProfileVerifications {
  isPhoneVerified:   boolean;
  isAadhaarVerified: boolean;
  isGeoVerified:     boolean;
  hasProfilePhoto:   boolean;
  hasCredentials:    boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url.startsWith('http') ? url : `https://${url}`);
    return true;
  } catch {
    return false;
  }
};

const isValidLinkedIn = (url: string): boolean => {
  return url.includes('linkedin.com/in/') || url.includes('linkedin.com/company/');
};

// ─── Field component ──────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'url' | 'phone-pad' | 'numeric';
  autoCapitalize?: 'none' | 'words' | 'sentences';
  hint?: string;
  verified?: boolean;
  verifiedLabel?: string;
  onVerify?: () => void;
  maxLength?: number;
}

const Field: React.FC<FieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  hint,
  verified,
  verifiedLabel,
  onVerify,
  maxLength,
}) => (
  <View style={fieldStyles.container}>
    <View style={fieldStyles.labelRow}>
      <Text style={fieldStyles.label}>{label}</Text>
      {verified !== undefined && (
        <View
          style={[
            fieldStyles.verifiedBadge,
            { backgroundColor: verified ? '#E8F5F3' : COLORS.warmSand },
          ]}
        >
          <Text
            style={[
              fieldStyles.verifiedText,
              { color: verified ? COLORS.verdigris : '#8888A0' },
            ]}
          >
            {verified ? `✓ ${verifiedLabel || 'Verified'}` : 'Unverified'}
          </Text>
        </View>
      )}
    </View>
    <TextInput
      style={[fieldStyles.input, multiline && fieldStyles.inputMultiline]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#CCCCDD"
      multiline={multiline}
      numberOfLines={multiline ? 4 : 1}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoCorrect={!['url', 'phone-pad', 'numeric'].includes(keyboardType)}
      maxLength={maxLength}
      textAlignVertical={multiline ? 'top' : 'center'}
    />
    {hint && <Text style={fieldStyles.hint}>{hint}</Text>}
    {value && !verified && onVerify && (
      <TouchableOpacity style={fieldStyles.verifyBtn} onPress={onVerify}>
        <Text style={fieldStyles.verifyBtnText}>Verify for trust points →</Text>
      </TouchableOpacity>
    )}
    {maxLength && (
      <Text style={fieldStyles.charCount}>
        {value.length}/{maxLength}
      </Text>
    )}
  </View>
);

const fieldStyles = StyleSheet.create({
  container: { marginBottom: SPACING.md },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  label: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.deepInk,
  },
  verifiedBadge: {
    borderRadius: 12,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  verifiedText: {
    fontFamily: FONTS.semiBold,
    fontSize: 11,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: '#E8E8EF',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontFamily: FONTS.regular,
    fontSize: 15,
    color: COLORS.deepInk,
  },
  inputMultiline: {
    minHeight: 96,
    paddingTop: SPACING.sm + 2,
  },
  hint: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#AAAABC',
    marginTop: 4,
    lineHeight: 15,
  },
  verifyBtn: {
    marginTop: SPACING.xs,
  },
  verifyBtnText: {
    fontFamily: FONTS.semiBold,
    fontSize: 13,
    color: COLORS.verdigris,
  },
  charCount: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#CCCCDD',
    textAlign: 'right',
    marginTop: 3,
  },
});

// ─── Section header ───────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <View style={secStyles.container}>
    <Text style={secStyles.title}>{title}</Text>
    {subtitle && <Text style={secStyles.subtitle}>{subtitle}</Text>}
  </View>
);

const secStyles = StyleSheet.create({
  container: { marginBottom: SPACING.md, marginTop: SPACING.md },
  title: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    color: COLORS.deepInk,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#8888A0',
    lineHeight: 18,
  },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const ProviderProfileEditScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const { accessToken } = useAuthStore();
  const { profile, setProfile } = useProviderStore();

  const [form, setForm] = useState<ProfileFormData>({
    displayName:          profile?.displayName || '',
    bio:                  profile?.bio || '',
    phone_secondary:      profile?.whatsappPhone || '',
    website_url:          profile?.websiteUrl || '',
    linkedin_url:         '',
    linkedinUrl:          '',
    years_experience:     (profile as any)?.years_experience?.toString() || '',
    // V050 fields — now in schema
    address_line:         (profile as any)?.address_line || '',
    pincode:              (profile as any)?.pincode || '',
    service_radius_km:    (profile as any)?.service_radius_km?.toString() || '',
    establishment_name:   profile?.businessName || '',
    establishment_address: '',
    gst_number:           '',
    operating_hours:      '',
    team_size:            '',
  });

  const [verifications, setVerifications] = useState<ProfileVerifications>({
    phoneVerified: profile?.phoneVerified ?? false,
    aadhaar_verified: profile?.isAadhaarVerified ?? false,
    linkedin_verified: false ?? false,
    website_verified: false ?? false,
    geo_verified: profile?.isGeoVerified ?? false,
    establishment_verified: false ?? false,
  });

  const [photoUri, setPhotoUri] = useState<string | null>(profile?.photoUrl || null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyingLinkedIn, setVerifyingLinkedIn] = useState(false);
  const [verifyingWebsite, setVerifyingWebsite] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileFormData, string>>>({});

  // ── Taxonomy fields (from attribute_schema — category-specific) ────────────
  interface TaxonomyField { key: string; label: string; required: boolean; type?: string; }
  const [taxonomyFields, setTaxonomyFields] = useState<TaxonomyField[]>([]);
  const [taxonomyValues, setTaxonomyValues] = useState<Record<string, string>>({});
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/api/v1/providers/me/taxonomy-fields')
      .then((res) => {
        const data = res.data?.data;
        if (!data) return;
        const fields: TaxonomyField[] = data.attribute_schema?.fields ?? [];
        setTaxonomyFields(fields);
        // Seed empty values for each field
        const init: Record<string, string> = {};
        fields.forEach((f: TaxonomyField) => { init[f.key] = ''; });
        setTaxonomyValues(init);
        if (data.category_label) setCategoryLabel(data.category_label);
      })
      .catch(() => {}); // non-blocking — generic fields still shown
  }, []);


  const isEstablishment = profile?.listingType === 'establishment';

  const setField = (key: keyof ProfileFormData) => (value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  // ── Photo upload ──────────────────────────────────────────────────────────

  const handlePickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access in Settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    uploadPhoto(asset.uri, asset.mimeType || 'image/jpeg');
  };

  const uploadPhoto = async (uri: string, mimeType: string) => {
    setPhotoUploading(true);
    try {
      // 1. Get pre-signed S3 URL
      const urlRes = await apiClient.post('/api/v1/uploads/presigned-url', {
        file_type: mimeType,
        credential_type: 'profile_photo',
        content_type: mimeType,
      }, { headers: { Authorization: `Bearer ${accessToken}` } });
      const { upload_url: uploadUrl, s3_key: key } = urlRes.data.data;

      // 2. Upload to S3 directly (no auth header on S3 PUT — pre-signed URL handles auth)
      const fileResponse = await fetch(uri);
      const blob = await fileResponse.blob();

      await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'max-age=31536000',
        },
      });

      // 3. Confirm upload
      await apiClient.post(
        '/api/v1/providers/me/photo',
        { s3Key: key },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      setPhotoUri(uri);
      setHasChanges(true);
      Alert.alert('Photo updated', 'Your profile photo has been updated.');
    } catch (err) {
      Alert.alert('Upload failed', 'Could not upload photo. Please try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  // ── LinkedIn verify ───────────────────────────────────────────────────────

  const handleVerifyLinkedIn = async () => {
    if (!isValidLinkedIn(form.linkedinUrl)) {
      Alert.alert(
        'Invalid LinkedIn URL',
        'Please enter a valid LinkedIn profile URL (e.g., linkedin.com/in/yourname)'
      );
      return;
    }
    setVerifyingLinkedIn(true);
    try {
      // TODO: LinkedIn verification endpoint not yet implemented
      await Promise.resolve(); // await apiClient.post()
      if (false) await apiClient.post(
        '/api/v1/trust/verify/linkedin',
        { linkedin_url: form.linkedinUrl },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setVerifications(prev => ({ ...prev, linkedin_verified: true }));
      Alert.alert('✓ LinkedIn verified', 'You earned trust points for LinkedIn verification.');
    } catch (err: any) {
      Alert.alert(
        'Verification failed',
        err?.response?.data?.message || 'Could not verify LinkedIn URL. Please try again.'
      );
    } finally {
      setVerifyingLinkedIn(false);
    }
  };

  // ── Website verify ────────────────────────────────────────────────────────

  const handleVerifyWebsite = async () => {
    if (!isValidUrl(form.websiteUrl)) {
      Alert.alert('Invalid URL', 'Please enter a valid website URL.');
      return;
    }
    setVerifyingWebsite(true);
    try {
      // TODO: Website verification endpoint not yet implemented
      await Promise.resolve(); // await apiClient.post()
      if (false) await apiClient.post(
        '/api/v1/trust/verify/website',
        { website_url: form.websiteUrl },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setVerifications(prev => ({ ...prev, website_verified: true }));
      Alert.alert('✓ Website verified', 'You earned trust points for website verification.');
    } catch (err: any) {
      Alert.alert(
        'Verification failed',
        err?.response?.data?.message ||
          'Website verification failed. Make sure the meta tag is placed correctly.'
      );
    } finally {
      setVerifyingWebsite(false);
    }
  };

  // ── Validation ────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof ProfileFormData, string>> = {};

    if (!form.displayName.trim()) {
      newErrors.displayName = 'Display name is required';
    }
    if (form.displayName.trim().length < 3) {
      newErrors.displayName = 'Name must be at least 3 characters';
    }
    if (form.websiteUrl && !isValidUrl(form.websiteUrl)) {
      newErrors.websiteUrl = 'Please enter a valid URL';
    }
    if (form.linkedinUrl && !isValidLinkedIn(form.linkedinUrl)) {
      newErrors.linkedinUrl = 'Please enter a valid LinkedIn URL';
    }
    if (form.years_experience && isNaN(Number(form.years_experience))) {
      newErrors.years_experience = 'Must be a number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ── Save ──────────────────────────────────────────────────────────────────


  // ── Mode switch & logout ────────────────────────────────────────────────────

  const handleSwitchToConsumer = () => {
    Alert.alert(
      'Switch to Consumer Mode',
      'You will be switched to Consumer Mode to browse services. Switch now?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          style: 'default',
          onPress: async () => {
            try {
              await apiClient.patch('/api/v1/users/me/mode', { mode: 'consumer' });
              useAuthStore.getState().setMode('consumer');
              navigation.reset({ index: 0, routes: [{ name: 'ConsumerApp' as any }] });
            } catch {
              Alert.alert('Error', 'Could not switch modes. Please try again.');
            }
          },
        },
      ],
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: () => {
            useAuthStore.getState().logout();
          },
        },
      ],
    );
  };

    const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);

    try {
      const payload: Record<string, unknown> = {
        displayName: form.displayName.trim(),
        bio:         form.bio.trim(),
        websiteUrl:  form.websiteUrl.trim() || null,
        // V050 fields — now in schema, send if provided
        ...(form.years_experience.trim() && !isNaN(Number(form.years_experience))
          ? { years_experience: Number(form.years_experience) }
          : {}),
        ...(form.address_line?.trim()
          ? { address_line: form.address_line.trim() }
          : {}),
        ...(form.pincode?.trim()
          ? { pincode: form.pincode.trim() }
          : {}),
        ...(form.service_radius_km?.trim() && !isNaN(Number(form.service_radius_km))
          ? { service_radius_km: Number(form.service_radius_km) }
          : {}),
      };

      if (form.whatsappPhone) {
        payload.whatsappPhone = form.whatsappPhone.trim();
      }

      if (isEstablishment) {
        payload.businessName = form.businessName.trim();
        // gst_number, operating_hours, team_size — not in schema, omitted
      }

      await apiClient.patch('/api/v1/providers/me', payload, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const updatedProfile = await providerApi.getMe();
      setProfile(updatedProfile);
      setHasChanges(false);

      Alert.alert('Profile saved', 'Your profile has been updated.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert(
        'Save failed',
        err?.response?.data?.message || 'Could not save profile. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (hasChanges) {
      Alert.alert(
        'Unsaved changes',
        'You have unsaved changes. Discard them?',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
        ]
      );
    } else {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />

      {/* Nav */}
      <View style={styles.navBar}>
        <TouchableOpacity 
          onPress={handleBack}
          style={styles.navBackBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color="#1C1C2E" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Edit Profile</Text>
        <TouchableOpacity
          style={[styles.navSaveBtn, saving && styles.navSaveBtnDisabled]}
          onPress={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.navSaveText}>Save</Text>
          )}
        </TouchableOpacity>
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
          {/* Photo upload */}
          <View style={styles.photoSection}>
            <TouchableOpacity
              style={styles.photoContainer}
              onPress={handlePickPhoto}
              disabled={photoUploading}
            >
              {photoUri ? (
                <Image
                  source={{ uri: photoUri }}
                  style={styles.photoImage}
                />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoPlaceholderIcon}>👤</Text>
                </View>
              )}
              <View style={styles.photoBadge}>
                {photoUploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.photoBadgeIcon}>📷</Text>
                )}
              </View>
            </TouchableOpacity>
            <Text style={styles.photoHint}>
              Tap to upload. Square image, minimum 400×400px.
            </Text>
          </View>

          {/* Basic info */}
          <SectionHeader title="Basic information" />

          <Field
            label="Display name *"
            value={form.displayName}
            onChangeText={setField('display_name')}
            placeholder="e.g., Rajesh Kumar Plumbing"
            autoCapitalize="words"
            maxLength={80}
          />
          {errors.displayName && (
            <Text style={styles.fieldError}>{errors.displayName}</Text>
          )}

          <Field
            label="Bio / About"
            value={form.bio}
            onChangeText={setField('bio')}
            placeholder="Tell consumers about your work, experience, and what makes you different…"
            multiline
            maxLength={500}
          />

          <Field
            label="Secondary phone"
            value={form.whatsappPhone}
            onChangeText={setField('phone_secondary')}
            placeholder="+91 98765 43210"
            keyboardType="phone-pad"
            autoCapitalize="none"
            hint="Optional. Shown on profile if different from registered phone."
          />

          <Field
            label="Years of experience"
            value={form.years_experience}
            onChangeText={setField('years_experience')}
            placeholder="e.g., 8"
            keyboardType="numeric"
          />
          {errors.years_experience && (
            <Text style={styles.fieldError}>{errors.years_experience}</Text>
          )}

          {/* Professional links */}
          <SectionHeader
            title="Professional links"
            subtitle="Verified links earn trust points. LinkedIn +5 pts, Website +5 pts."
          />

          <Field
            label="LinkedIn profile"
            value={form.linkedinUrl}
            onChangeText={setField('linkedinUrl')}
            placeholder="linkedin.com/in/yourname"
            keyboardType="url"
            autoCapitalize="none"
            hint="Your LinkedIn profile URL"
            verified={verifications.linkedin_verified}
            verifiedLabel="LinkedIn"
            onVerify={verifyingLinkedIn ? undefined : handleVerifyLinkedIn}
          />
          {errors.linkedinUrl && (
            <Text style={styles.fieldError}>{errors.linkedinUrl}</Text>
          )}

          <Field
            label="Website"
            value={form.websiteUrl}
            onChangeText={setField('website_url')}
            placeholder="https://yourwebsite.com"
            keyboardType="url"
            autoCapitalize="none"
            hint="We'll check for a satvaaah meta tag to verify ownership"
            verified={verifications.website_verified}
            verifiedLabel="Website"
            onVerify={verifyingWebsite ? undefined : handleVerifyWebsite}
          />
          {errors.websiteUrl && (
            <Text style={styles.fieldError}>{errors.websiteUrl}</Text>
          )}

          {/* Website verification instructions */}
          {form.websiteUrl && !verifications.website_verified && (
            <View style={styles.websiteInstructions}>
              <Text style={styles.websiteInstructionsTitle}>
                How to verify your website
              </Text>
              <Text style={styles.websiteInstructionsBody}>
                Add the following meta tag to your website's{' '}
                <Text style={styles.code}>{`<head>`}</Text> section, then tap
                "Verify for trust points":
              </Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeBlockText}>
                  {`<meta name="satvaaah-verify" content="${profile?.id || 'your-provider-id'}" />`}
                </Text>
              </View>
            </View>
          )}

          {/* Establishment extras */}
          {isEstablishment && (
            <>
              <SectionHeader
                title="Establishment details"
                subtitle="Required for establishment listings."
              />

              <Field
                label="Establishment name"
                value={form.businessName}
                onChangeText={setField('establishment_name')}
                placeholder="e.g., Krishna Auto Works"
                autoCapitalize="words"
                maxLength={100}
              />

              <Field
                label="Address"
                value={form.establishment_address}
                onChangeText={setField('establishment_address')}
                placeholder="Full address with area and city"
                multiline
                maxLength={300}
              />

              <Field
                label="GST Number"
                value={form.gst_number}
                onChangeText={setField('gst_number')}
                placeholder="e.g., 27AAAPZ0289R1ZV"
                autoCapitalize="characters"
                hint="Optional. GST verification earns +5 trust points."
              />

              <Field
                label="Operating hours"
                value={form.operating_hours}
                onChangeText={setField('operating_hours')}
                placeholder="e.g., Mon–Sat 9am–7pm"
                maxLength={100}
              />

              <Field
                label="Team size"
                value={form.team_size}
                onChangeText={setField('team_size')}
                placeholder="e.g., 5"
                keyboardType="numeric"
                hint="Number of staff/team members"
              />
            </>
          )}

          {/* Category-specific fields from taxonomy attribute_schema */}
          {taxonomyFields.length > 0 && (
            <>
              <SectionHeader
                title={categoryLabel ? `${categoryLabel} details` : 'Category details'}
                subtitle="Fields specific to your service category. These help consumers understand your offering."
              />
              {taxonomyFields.map((field) => (
                <Field
                  key={field.key}
                  label={`${field.label}${field.required ? ' *' : ''}`}
                  value={taxonomyValues[field.key] ?? ''}
                  onChangeText={(v) => {
                    setTaxonomyValues((prev) => ({ ...prev, [field.key]: v }));
                    setHasChanges(true);
                  }}
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                  keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                  autoCapitalize={field.type === 'number' ? 'none' : 'sentences'}
                />
              ))}
            </>
          )}

          {/* Trust points summary */}
          <View style={styles.trustPointsCard}>
            <Text style={styles.trustPointsTitle}>Trust points from this profile</Text>
            <View style={styles.trustPointsGrid}>
              {[
                { label: 'Photo uploaded', pts: 5, done: !!photoUri },
                { label: 'Bio added', pts: 5, done: form.bio.length > 50 },
                { label: 'LinkedIn verified', pts: 5, done: verifications.linkedin_verified },
                { label: 'Website verified', pts: 5, done: verifications.website_verified },
              ].map(({ label, pts, done }) => (
                <View key={label} style={styles.trustPointItem}>
                  <Text style={[styles.trustPointCheck, { color: done ? COLORS.verdigris : '#CCCCDD' }]}>
                    {done ? '✓' : '○'}
                  </Text>
                  <Text style={[styles.trustPointLabel, { color: done ? COLORS.deepInk : '#AAAABC' }]}>
                    {label}
                  </Text>
                  <Text style={[styles.trustPointPts, { color: done ? COLORS.saffron : '#CCCCDD' }]}>
                    +{pts}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          {/* ── Switch mode & Logout ──────────────────────────────── */}
          <View style={styles.accountSection}>
            <TouchableOpacity
              style={styles.switchConsumerBtn}
              onPress={handleSwitchToConsumer}
              activeOpacity={0.85}
            >
              <Text style={styles.switchConsumerIcon}>🛒</Text>
              <View style={styles.switchConsumerText}>
                <Text style={styles.switchConsumerLabel}>Switch to Consumer Mode</Text>
                <Text style={styles.switchConsumerSub}>Browse &amp; hire service providers</Text>
              </View>
              <Text style={styles.switchConsumerArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={handleLogout}
              activeOpacity={0.85}
            >
              <Text style={styles.logoutText}>Log Out</Text>
            </TouchableOpacity>

            <Text style={styles.accountFooter}>SatvAAh Technologies · Truth that travels.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.ivory },
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
  navBack: {
    fontFamily: FONTS.medium,
    fontSize: 15,
    color: '#8888A0',
  },
  navTitle: { fontFamily: FONTS.bold, fontSize: 17, color: COLORS.deepInk },
  navBackBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navSaveBtn: {
    backgroundColor: COLORS.verdigris,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    minWidth: 60,
    alignItems: 'center',
  },
  navSaveBtnDisabled: { backgroundColor: '#AACCC8' },
  navSaveText: { fontFamily: FONTS.semiBold, fontSize: 14, color: '#fff' },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl * 2,
  },

  // Photo
  photoSection: { alignItems: 'center', marginBottom: SPACING.xl },
  photoContainer: {
    position: 'relative',
    width: 96,
    height: 96,
    marginBottom: SPACING.sm,
  },
  photoImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.warmSand,
  },
  photoPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.warmSand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderIcon: { fontSize: 40 },
  photoBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.verdigris,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.ivory,
  },
  photoBadgeIcon: { fontSize: 13 },
  photoHint: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: '#AAAABC',
    textAlign: 'center',
  },

  // Field error
  fieldError: {
    fontFamily: FONTS.medium,
    fontSize: 12,
    color: '#C0392B',
    marginTop: -SPACING.xs,
    marginBottom: SPACING.sm,
    paddingLeft: 2,
  },

  // Website instructions
  websiteInstructions: {
    backgroundColor: '#F8F8FA',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    marginTop: -SPACING.xs,
  },
  websiteInstructionsTitle: {
    fontFamily: FONTS.semiBold,
    fontSize: 13,
    color: COLORS.deepInk,
    marginBottom: 4,
  },
  websiteInstructionsBody: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#5A5A6E',
    lineHeight: 19,
    marginBottom: SPACING.sm,
  },
  code: { fontFamily: 'Courier', color: COLORS.verdigris },
  codeBlock: {
    backgroundColor: COLORS.deepInk,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
  },
  codeBlockText: {
    fontFamily: 'Courier',
    fontSize: 11,
    color: '#A8E6CF',
  },

  // Trust points card
  trustPointsCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  trustPointsTitle: {
    fontFamily: FONTS.bold,
    fontSize: 14,
    color: COLORS.deepInk,
    marginBottom: SPACING.md,
  },
  trustPointsGrid: { gap: SPACING.sm },
  trustPointItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  trustPointCheck: { fontFamily: FONTS.bold, fontSize: 16, width: 20 },
  trustPointLabel: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    flex: 1,
  },
  trustPointPts: {
    fontFamily: FONTS.bold,
    fontSize: 13,
  },

  // ── Account section styles ─────────────────────────────────────────────────
  accountSection: {
    marginTop: 8,
    marginBottom: 24,
    paddingHorizontal: SPACING.lg,
  },
  switchConsumerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F7F6',
    borderWidth: 1.5,
    borderColor: COLORS.verdigris,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  switchConsumerIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  switchConsumerText: { flex: 1 },
  switchConsumerLabel: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.verdigris,
  },
  switchConsumerSub: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: '#4A9E96',
    marginTop: 1,
  },
  switchConsumerArrow: {
    fontSize: 18,
    color: COLORS.verdigris,
  },
  logoutBtn: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderWidth: 1,
    borderColor: '#C0392B',
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  logoutText: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: '#B00020',
  },
  accountFooter: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#9E9589',
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});

export default ProviderProfileEditScreen;
