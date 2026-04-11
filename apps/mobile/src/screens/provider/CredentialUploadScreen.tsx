/**
 * CredentialUploadScreen.tsx
 * Phase 24 — Provider Verification
 *
 * Credential type driven by taxonomy_node.attribute_schema.
 * File: PDF / JPG / PNG, max 5MB.
 * Upload via S3 pre-signed URL (PUT directly to S3).
 * Status: pending_review → verified | rejected (24-48h human review).
 * Verified credentials → trust points (from trust_score_config table).
 *
 * Upload flow:
 * 1. GET /user/v1/provider/credential-upload-url?type={type} → { upload_url, key }
 * 2. PUT to S3 pre-signed URL (binary)
 * 3. POST /user/v1/provider/credential-submit { key, type, issuer, expiry } → credential record
 *
 * V004 provider_profiles: credential-related verification flags
 * V017 taxonomy_nodes: attribute_schema JSONB contains credential type list
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../stores/auth.store';
import { apiClient } from '../../api/client';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { ProviderStackParamList } from '../../navigation/ProviderStack';

// ─── Types ────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<ProviderStackParamList, 'CredentialUpload'>;

interface CredentialType {
  id: string;
  label: string;
  description: string;
  accepted_formats: ('pdf' | 'jpg' | 'png')[];
  example: string;
  trust_pts: number;
}

interface UploadedCredential {
  id: string;
  type: string;
  type_label: string;
  filename: string;
  status: 'pending_review' | 'verified' | 'rejected';
  submitted_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  trust_pts_awarded: number;
}

type UploadState = 'idle' | 'selecting_type' | 'selecting_file' | 'uploading' | 'submitted';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// ─── Credential type definitions (taxonomy-driven in production) ──────────────

const DEFAULT_CREDENTIAL_TYPES: CredentialType[] = [
  {
    id: 'govt_id',
    label: 'Government ID',
    description: 'Pan card, Voter ID, Driving license, or Passport',
    accepted_formats: ['pdf', 'jpg', 'png'],
    example: 'PAN card, Driving License',
    trust_pts: 10,
  },
  {
    id: 'professional_cert',
    label: 'Professional Certificate',
    description: 'Trade certificate, ITI certificate, skill certificate, or diploma',
    accepted_formats: ['pdf', 'jpg', 'png'],
    example: 'ITI Certificate, NSDC Certificate',
    trust_pts: 15,
  },
  {
    id: 'business_registration',
    label: 'Business Registration',
    description: 'GST certificate, Shop & Establishment Act registration, MSME certificate',
    accepted_formats: ['pdf'],
    example: 'GST Certificate, MSME Registration',
    trust_pts: 15,
  },
  {
    id: 'experience_letter',
    label: 'Experience Letter',
    description: 'Employment letter or experience certificate from a previous employer',
    accepted_formats: ['pdf', 'jpg', 'png'],
    example: 'Employment Letter from past employer',
    trust_pts: 10,
  },
  {
    id: 'degree_certificate',
    label: 'Degree / Diploma',
    description: 'Academic degree, diploma, or educational qualification certificate',
    accepted_formats: ['pdf', 'jpg', 'png'],
    example: 'B.Tech Degree, MBBS Certificate',
    trust_pts: 10,
  },
  {
    id: 'license',
    label: 'Professional License / Permit',
    description: 'Government-issued professional license or permit required for your trade',
    accepted_formats: ['pdf', 'jpg', 'png'],
    example: 'Medical License, Contractor License',
    trust_pts: 20,
  },
  {
    id: 'insurance',
    label: 'Professional Insurance',
    description: 'Liability insurance or professional indemnity certificate',
    accepted_formats: ['pdf'],
    example: 'Public Liability Insurance',
    trust_pts: 10,
  },
  {
    id: 'training_certificate',
    label: 'Training Certificate',
    description: 'Safety training, first aid, or other professional training certificates',
    accepted_formats: ['pdf', 'jpg', 'png'],
    example: 'Fire Safety Certificate, First Aid',
    trust_pts: 5,
  },
];

const STATUS_META: Record<UploadedCredential['status'], { label: string; color: string; icon: string }> = {
  pending_review: { label: 'Under review (24-48h)', color: COLORS.saffron, icon: '🔍' },
  verified: { label: 'Verified', color: COLORS.verdigris, icon: '✓' },
  rejected: { label: 'Rejected', color: '#C0392B', icon: '✗' },
};

const FORMAT_ICONS: Record<string, string> = {
  pdf: '📄',
  jpg: '🖼️',
  png: '🖼️',
};

// ─── Credential status card ───────────────────────────────────────────────────

interface StatusCardProps {
  credential: UploadedCredential;
  onRetry: () => void;
}

const CredentialStatusCard: React.FC<StatusCardProps> = ({ credential, onRetry }) => {
  const meta = STATUS_META[credential.status];

  return (
    <View style={statusCardStyles.card}>
      <View style={statusCardStyles.header}>
        <View style={statusCardStyles.typeInfo}>
          <Text style={statusCardStyles.typeLabel}>{credential.type_label}</Text>
          <Text style={statusCardStyles.filename}>{credential.filename}</Text>
        </View>
        <View
          style={[statusCardStyles.statusBadge, { backgroundColor: `${meta.color}18` }]}
        >
          <Text style={[statusCardStyles.statusIcon]}>{meta.icon}</Text>
          <Text style={[statusCardStyles.statusText, { color: meta.color }]}>
            {meta.label}
          </Text>
        </View>
      </View>

      {credential.status === 'verified' && credential.trust_pts_awarded > 0 && (
        <View style={statusCardStyles.ptsRow}>
          <Text style={statusCardStyles.ptsText}>
            +{credential.trust_pts_awarded} trust points awarded ⭐
          </Text>
        </View>
      )}

      {credential.status === 'rejected' && (
        <View style={statusCardStyles.rejectionBox}>
          <Text style={statusCardStyles.rejectionLabel}>Reason:</Text>
          <Text style={statusCardStyles.rejectionText}>
            {credential.rejection_reason || 'Document could not be verified. Please upload a clearer copy.'}
          </Text>
          <TouchableOpacity style={statusCardStyles.retryBtn} onPress={onRetry}>
            <Text style={statusCardStyles.retryBtnText}>Upload again</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={statusCardStyles.date}>
        Submitted{' '}
        {new Date(credential.submitted_at).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Kolkata',
        })}
      </Text>
    </View>
  );
};

const statusCardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.xs,
    gap: SPACING.sm,
  },
  typeInfo: { flex: 1 },
  typeLabel: { fontFamily: FONTS.semiBold, fontSize: 14, color: COLORS.deepInk, marginBottom: 2 },
  filename: { fontFamily: FONTS.regular, fontSize: 12, color: '#AAAABC' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    flexShrink: 0,
  },
  statusIcon: { fontSize: 12 },
  statusText: { fontFamily: FONTS.semiBold, fontSize: 11 },
  ptsRow: {
    backgroundColor: '#E8F5F3',
    borderRadius: RADIUS.sm,
    padding: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  ptsText: { fontFamily: FONTS.semiBold, fontSize: 13, color: COLORS.verdigris, textAlign: 'center' },
  rejectionBox: {
    backgroundColor: '#FFF3F3',
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  rejectionLabel: { fontFamily: FONTS.semiBold, fontSize: 12, color: '#C0392B', marginBottom: 2 },
  rejectionText: { fontFamily: FONTS.regular, fontSize: 13, color: '#5A5A6E', lineHeight: 18 },
  retryBtn: { marginTop: SPACING.xs },
  retryBtnText: { fontFamily: FONTS.semiBold, fontSize: 13, color: COLORS.verdigris },
  date: { fontFamily: FONTS.regular, fontSize: 11, color: '#CCCCDD' },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const CredentialUploadScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const { accessToken } = useAuthStore();

  const [credentialTypes, setCredentialTypes] = useState<CredentialType[]>(DEFAULT_CREDENTIAL_TYPES);
  const [existingCredentials, setExistingCredentials] = useState<UploadedCredential[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(true);

  const [selectedType, setSelectedType] = useState<CredentialType | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFileName, setSelectedFileName] = useState('');

  useEffect(() => {
    fetchExistingCredentials();
    fetchTaxonomyTypes();
  }, []);

  const fetchTaxonomyTypes = async () => {
    try {
      // In production, credential types come from taxonomy_node.attribute_schema
      // for the provider's specific category
      const res = await apiClient.get('/api/v1/providers/me/credentials', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.data?.credential_types?.length > 0) {
        setCredentialTypes(res.data.credential_types);
      }
    } catch {
      // Use defaults if taxonomy fetch fails
    }
  };

  const fetchExistingCredentials = async () => {
    setLoadingExisting(true);
    try {
      const res = await apiClient.get('/api/v1/providers/me/credentials', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setExistingCredentials(res.data.data || []);
    } catch {
      // Silently fail — existing credentials are supplementary
    } finally {
      setLoadingExisting(false);
    }
  };

  const handleSelectFile = async () => {
    if (!selectedType) return;

    const acceptsPdf = selectedType.accepted_formats.includes('pdf');
    const acceptsImages =
      selectedType.accepted_formats.includes('jpg') ||
      selectedType.accepted_formats.includes('png');

    Alert.alert(
      'Choose file type',
      'How would you like to add your credential?',
      [
        acceptsPdf
          ? {
              text: '📄 PDF Document',
              onPress: () => pickDocument(),
            }
          : null,
        acceptsImages
          ? {
              text: '🖼️ Photo / Image',
              onPress: () => pickImage(),
            }
          : null,
        { text: 'Cancel', style: 'cancel' },
      ].filter(Boolean) as any[]
    );
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_FILE_SIZE) {
        Alert.alert('File too large', 'Maximum file size is 5MB. Please compress your PDF.');
        return;
      }

      setSelectedFileName(asset.name);
      await uploadCredential(asset.uri, 'application/pdf', asset.name);
    } catch (err) {
      Alert.alert('Error', 'Could not open the file. Please try again.');
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access in Settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.9,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const fileName = asset.fileName || `credential_${Date.now()}.jpg`;
    const mimeType = asset.mimeType || 'image/jpeg';

    setSelectedFileName(fileName);
    await uploadCredential(asset.uri, mimeType, fileName);
  };

  const uploadCredential = async (uri: string, mimeType: string, filename: string) => {
    if (!selectedType) return;
    setUploadState('uploading');
    setUploadProgress(0);

    try {
      // 1. Get pre-signed upload URL
      // POST /api/v1/providers/me/credentials with credential_type, file_name, content_type
      setUploadProgress(10);
      const urlRes = await apiClient.post(
        '/api/v1/providers/me/credentials',
        {
          credential_type: selectedType.id,
          file_name:       filename,
          content_type:    mimeType,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const { upload_url, s3_key } = urlRes.data.data;

      // 2. Upload directly to S3
      setUploadProgress(30);
      const fileResponse = await fetch(uri);
      const blob = await fileResponse.blob();

      // Verify size
      if (blob.size > MAX_FILE_SIZE) {
        setUploadState('selecting_type');
        Alert.alert('File too large', 'Maximum file size is 5MB.');
        return;
      }

      setUploadProgress(60);
      const uploadRes = await fetch(upload_url, {
        method: 'PUT',
        body: blob,
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });

      if (!uploadRes.ok) throw new Error('S3 upload failed');

      setUploadProgress(85);

      // 3. Submit credential record
      await apiClient.post(
        '/api/v1/providers/me/credentials/confirm',
        {
          s3_key:          s3_key,
          credential_type: selectedType.id,
          file_name:       filename,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      setUploadProgress(100);
      setUploadState('submitted');

      // Refresh list
      await fetchExistingCredentials();
    } catch (err: any) {
      setUploadState('selecting_type');
      Alert.alert(
        'Upload failed',
        err?.response?.data?.message || 'Could not upload credential. Please try again.'
      );
    }
  };

  const resetUpload = () => {
    setSelectedType(null);
    setUploadState('idle');
    setUploadProgress(0);
    setSelectedFileName('');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />

      {/* Nav */}
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={() =>
            uploadState === 'uploading' ? null : navigation.goBack()
          }
        >
          <Text
            style={[
              styles.navBack,
              uploadState === 'uploading' && { color: '#CCCCDD' },
            ]}
          >
            ←
          </Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Upload Credential</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro */}
        <View style={styles.introCard}>
          <Text style={styles.introIcon}>📜</Text>
          <Text style={styles.introTitle}>Verify your credentials</Text>
          <Text style={styles.introBody}>
            Each verified credential earns trust points and builds consumer confidence.
            Our team reviews all documents within{' '}
            <Text style={styles.introHighlight}>24–48 hours</Text>.
          </Text>
        </View>

        {/* Upload flow */}
        {uploadState === 'idle' || uploadState === 'selecting_type' ? (
          <>
            <Text style={styles.sectionLabel}>Choose credential type</Text>
            <View style={styles.typeGrid}>
              {credentialTypes.map(ct => (
                <TouchableOpacity
                  key={ct.id}
                  style={[
                    styles.typeCard,
                    selectedType?.id === ct.id && styles.typeCardSelected,
                  ]}
                  onPress={() => {
                    setSelectedType(ct);
                    setUploadState('selecting_type');
                  }}
                >
                  <View style={styles.typeCardHeader}>
                    <Text style={styles.typeCardLabel}>{ct.label}</Text>
                    <View style={styles.ptsChip}>
                      <Text style={styles.ptsChipText}>+{ct.trust_pts}</Text>
                    </View>
                  </View>
                  <Text style={styles.typeCardExample}>{ct.example}</Text>
                  <View style={styles.typeCardFormats}>
                    {ct.accepted_formats.map(f => (
                      <Text key={f} style={styles.formatTag}>
                        {FORMAT_ICONS[f]} {f.toUpperCase()}
                      </Text>
                    ))}
                  </View>
                  {selectedType?.id === ct.id && (
                    <View style={styles.typeCardSelected_indicator}>
                      <Text style={styles.typeCardSelectedText}>✓ Selected</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {selectedType && (
              <View style={styles.selectedTypeBar}>
                <View style={styles.selectedTypeInfo}>
                  <Text style={styles.selectedTypeLabel}>
                    Selected: {selectedType.label}
                  </Text>
                  <Text style={styles.selectedTypeDesc}>{selectedType.description}</Text>
                </View>
                <TouchableOpacity
                  style={styles.uploadBtn}
                  onPress={handleSelectFile}
                >
                  <Text style={styles.uploadBtnText}>Choose File</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : uploadState === 'uploading' ? (
          <View style={styles.uploadingState}>
            <ActivityIndicator size="large" color={COLORS.verdigris} />
            <Text style={styles.uploadingTitle}>Uploading…</Text>
            <Text style={styles.uploadingFile}>{selectedFileName}</Text>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${uploadProgress}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{uploadProgress}%</Text>
          </View>
        ) : uploadState === 'submitted' ? (
          <View style={styles.submittedState}>
            <Text style={styles.submittedIcon}>🎉</Text>
            <Text style={styles.submittedTitle}>Credential submitted!</Text>
            <Text style={styles.submittedBody}>
              Our team will review <Text style={styles.submittedBold}>{selectedFileName}</Text> within
              24–48 hours. You'll receive a notification when it's verified.
            </Text>
            <View style={styles.submittedTimeline}>
              {[
                { label: 'Submitted', done: true },
                { label: 'Under review', done: false },
                { label: 'Verified ✓', done: false },
              ].map((step, i) => (
                <View key={i} style={styles.timelineStep}>
                  <View
                    style={[
                      styles.timelineStepDot,
                      { backgroundColor: step.done ? COLORS.verdigris : '#E8E8EF' },
                    ]}
                  />
                  <Text
                    style={[
                      styles.timelineStepLabel,
                      { color: step.done ? COLORS.deepInk : '#AAAABC' },
                    ]}
                  >
                    {step.label}
                  </Text>
                  {i < 2 && <View style={styles.timelineStepLine} />}
                </View>
              ))}
            </View>
            <TouchableOpacity style={styles.uploadAnotherBtn} onPress={resetUpload}>
              <Text style={styles.uploadAnotherText}>Upload another credential</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Existing credentials */}
        {existingCredentials.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Your credentials</Text>
            {loadingExisting ? (
              <ActivityIndicator color={COLORS.verdigris} />
            ) : (
              existingCredentials.map(c => (
                <CredentialStatusCard
                  key={c.id}
                  credential={c}
                  onRetry={() => {
                    const type = credentialTypes.find(t => t.id === c.type);
                    if (type) {
                      setSelectedType(type);
                      setUploadState('selecting_type');
                      // Scroll to top
                    }
                  }}
                />
              ))
            )}
          </>
        )}

        {/* Guidelines */}
        <View style={styles.guidelinesCard}>
          <Text style={styles.guidelinesTitle}>Upload guidelines</Text>
          {[
            'Maximum file size: 5MB (PDF, JPG, PNG)',
            'Documents must be clear and fully visible',
            'Expired documents will not be accepted',
            'Cropped or incomplete documents will be rejected',
            'All documents are stored securely on AWS S3',
            "Documents are reviewed by SatvAAh's verification team",
          ].map((g, i) => (
            <View key={i} style={styles.guidelineItem}>
              <Text style={styles.guidelineDot}>•</Text>
              <Text style={styles.guidelineText}>{g}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
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
  navBack: { fontFamily: FONTS.semiBold, fontSize: 20, color: COLORS.deepInk },
  navTitle: { fontFamily: FONTS.bold, fontSize: 17, color: COLORS.deepInk },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl * 2,
  },
  sectionLabel: {
    fontFamily: FONTS.bold,
    fontSize: 16,
    color: COLORS.deepInk,
    marginBottom: SPACING.md,
    marginTop: SPACING.sm,
  },

  // Intro
  introCard: {
    backgroundColor: COLORS.warmSand,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  introIcon: { fontSize: 36, marginBottom: SPACING.sm },
  introTitle: {
    fontFamily: FONTS.bold,
    fontSize: 18,
    color: COLORS.deepInk,
    marginBottom: SPACING.sm,
  },
  introBody: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    color: '#5A5A6E',
    textAlign: 'center',
    lineHeight: 21,
  },
  introHighlight: { fontFamily: FONTS.bold, color: COLORS.saffron },

  // Type grid
  typeGrid: { gap: SPACING.sm, marginBottom: SPACING.lg },
  typeCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5,
    borderColor: '#E8E8EF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  typeCardSelected: {
    borderColor: COLORS.verdigris,
    shadowColor: COLORS.verdigris,
    shadowOpacity: 0.15,
  },
  typeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  typeCardLabel: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.deepInk,
    flex: 1,
  },
  ptsChip: {
    backgroundColor: '#FFF0E0',
    borderRadius: 10,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    flexShrink: 0,
  },
  ptsChipText: { fontFamily: FONTS.bold, fontSize: 12, color: COLORS.saffron },
  typeCardExample: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: '#8888A0',
    marginBottom: SPACING.xs,
  },
  typeCardFormats: { flexDirection: 'row', gap: SPACING.xs },
  formatTag: { fontFamily: FONTS.regular, fontSize: 11, color: '#AAAABC' },
  typeCardSelected_indicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.verdigris,
    borderTopLeftRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  typeCardSelectedText: { fontFamily: FONTS.semiBold, fontSize: 11, color: '#fff' },

  // Selected type action bar
  selectedTypeBar: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderWidth: 1.5,
    borderColor: COLORS.verdigris,
    marginBottom: SPACING.lg,
    shadowColor: COLORS.verdigris,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  selectedTypeInfo: { flex: 1 },
  selectedTypeLabel: { fontFamily: FONTS.semiBold, fontSize: 14, color: COLORS.deepInk },
  selectedTypeDesc: { fontFamily: FONTS.regular, fontSize: 12, color: '#8888A0', marginTop: 2 },
  uploadBtn: {
    backgroundColor: COLORS.verdigris,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  uploadBtnText: { fontFamily: FONTS.semiBold, fontSize: 14, color: '#fff' },

  // Uploading state
  uploadingState: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  uploadingTitle: { fontFamily: FONTS.bold, fontSize: 18, color: COLORS.deepInk },
  uploadingFile: { fontFamily: FONTS.regular, fontSize: 13, color: '#8888A0' },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#F0F0F5',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.verdigris,
    borderRadius: 4,
  },
  progressText: { fontFamily: FONTS.medium, fontSize: 13, color: '#8888A0' },

  // Submitted state
  submittedState: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  submittedIcon: { fontSize: 44, marginBottom: SPACING.sm },
  submittedTitle: {
    fontFamily: FONTS.bold,
    fontSize: 20,
    color: COLORS.deepInk,
    marginBottom: SPACING.sm,
  },
  submittedBody: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    color: '#5A5A6E',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: SPACING.lg,
  },
  submittedBold: { fontFamily: FONTS.semiBold, color: COLORS.deepInk },
  submittedTimeline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  timelineStep: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  timelineStepDot: { width: 10, height: 10, borderRadius: 5 },
  timelineStepLabel: { fontFamily: FONTS.medium, fontSize: 12 },
  timelineStepLine: { width: 24, height: 1, backgroundColor: '#E8E8EF' },
  uploadAnotherBtn: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  uploadAnotherText: { fontFamily: FONTS.semiBold, fontSize: 15, color: COLORS.verdigris },

  // Guidelines
  guidelinesCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  guidelinesTitle: {
    fontFamily: FONTS.bold,
    fontSize: 14,
    color: COLORS.deepInk,
    marginBottom: SPACING.md,
  },
  guidelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  guidelineDot: { fontFamily: FONTS.regular, fontSize: 13, color: '#AAAABC', marginTop: 1 },
  guidelineText: { fontFamily: FONTS.regular, fontSize: 13, color: '#5A5A6E', flex: 1, lineHeight: 19 },
});

export default CredentialUploadScreen;
