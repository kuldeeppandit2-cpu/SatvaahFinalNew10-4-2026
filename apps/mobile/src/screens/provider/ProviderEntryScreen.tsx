/**
 * SatvAAh — ProviderEntryScreen
 * First screen for provider onboarding.
 * Two paths: Claim existing scraped profile | Create new profile
 *
 * Claim path: searches by phone → if found → ClaimProfileScreen
 *             if not found → shows message → EntityType
 * Create path: → EntityType directly
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, StatusBar, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProviderOnboardingParamList } from '../../navigation/provider.navigator';
import { useAuthStore } from '../../stores/auth.store';
import { providerApi } from '../../api/provider.api';

type Props = NativeStackScreenProps<ProviderOnboardingParamList, 'ProviderEntry'>;

export default function ProviderEntryScreen({
  navigation }: Props) {
  const phone = useAuthStore((s) => s.phone) ?? '';
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const displayPhone = phone.replace('+91', '+91 ').replace(/(\d{5})(\d{5})/, '$1 $2');

  async function handleClaim() {
    setSearching(true);
    setNotFound(false);
    try {
      const scraped = await providerApi.getScrapedProfileByPhone(phone);
      if (scraped) {
        navigation.navigate('ClaimProfile', { profile: scraped });
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setSearching(false);
    }
  }

  function handleCreate() {
    navigation.navigate('EntityType');
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0F0F1A" />

      {/* Dark top */}
      <SafeAreaView style={s.top} edges={['top']}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}
      >
        <Text style={{ fontSize: 16, color: '#C8691A', fontFamily: 'PlusJakartaSans-SemiBold' }}>← Back</Text>
      </TouchableOpacity>
        <Text style={s.logo}>SatvAAh</Text>
        <Text style={s.headline}>Join as a Provider</Text>
        <Text style={s.sub}>
          If you already have a presence on JustDial, Google, Zomato or Sulekha — we may have already found you.
        </Text>
      </SafeAreaView>

      {/* White card */}
      <View style={s.card}>

        {/* Not found message */}
        {notFound && (
          <View style={s.notFoundBox}>
            <Text style={s.notFoundIcon}>🔍</Text>
            <Text style={s.notFoundTitle}>No profile found for {displayPhone}</Text>
            <Text style={s.notFoundSub}>No problem — create your profile in under 2 minutes.</Text>
          </View>
        )}

        {/* Claim card */}
        {!notFound && (
          <TouchableOpacity
            style={s.claimCard}
            onPress={handleClaim}
            disabled={searching}
            activeOpacity={0.88}
          >
            <View style={s.claimIconWrap}>
              <Text style={s.claimIcon}>🔍</Text>
            </View>
            <View style={s.claimBody}>
              <Text style={s.claimTitle}>Find & claim my profile</Text>
              <Text style={s.claimSub}>
                We search {displayPhone} across JustDial, Google Maps, Sulekha and more
              </Text>
              {searching
                ? <View style={s.claimSearching}>
                    <ActivityIndicator size="small" color="#2E7D72" />
                    <Text style={s.claimSearchingTxt}>Searching…</Text>
                  </View>
                : <Text style={s.claimCta}>Search now →</Text>
              }
            </View>
          </TouchableOpacity>
        )}

        {/* Divider */}
        <View style={s.divider}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>or</Text>
          <View style={s.divLine} />
        </View>

        {/* Create card */}
        <TouchableOpacity
          style={s.createCard}
          onPress={handleCreate}
          activeOpacity={0.88}
        >
          <View style={s.createIconWrap}>
            <Text style={s.createIcon}>✦</Text>
          </View>
          <View style={s.createBody}>
            <Text style={s.createTitle}>Create my profile</Text>
            <Text style={s.createSub}>Start fresh. Live in under 2 minutes. Zero commission.</Text>
            <Text style={s.createCta}>Get started →</Text>
          </View>
        </TouchableOpacity>

        <Text style={s.legal}>
          Your profile goes live immediately after setup. Edit or remove anytime.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#0F0F1A' },
  top:      { paddingHorizontal: 28, paddingBottom: 28, paddingTop: 8 },
  logo:     { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 28, color: '#C8691A', marginBottom: 16 },
  headline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 28, color: '#FAF7F0', marginBottom: 10, lineHeight: 34 },
  sub:      { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: 'rgba(250,247,240,0.55)', lineHeight: 22 },
  card:     { flex: 1, backgroundColor: '#FAF7F0', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 28 },

  notFoundBox:   { backgroundColor: '#FEF3E8', borderRadius: 14, padding: 16, marginBottom: 16, alignItems: 'center' },
  notFoundIcon:  { fontSize: 28, marginBottom: 8 },
  notFoundTitle: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: '#1C1C2E', textAlign: 'center', marginBottom: 4 },
  notFoundSub:   { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: '#1C1C2E', textAlign: 'center' },

  claimCard:     { backgroundColor: '#EDF5F4', borderRadius: 16, padding: 18, flexDirection: 'row', gap: 14, borderWidth: 2, borderColor: '#2E7D72', marginBottom: 8 },
  claimIconWrap: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#2E7D72', alignItems: 'center', justifyContent: 'center' },
  claimIcon:     { fontSize: 22 },
  claimBody:     { flex: 1 },
  claimTitle:    { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: '#1C1C2E', marginBottom: 4 },
  claimSub:      { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12.5, color: '#4A6561', lineHeight: 18, marginBottom: 8 },
  claimCta:      { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: '#2E7D72' },
  claimSearching:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  claimSearchingTxt: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: '#2E7D72' },

  divider:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  divLine:   { flex: 1, height: 1, backgroundColor: '#E8E0D0' },
  divTxt:    { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: '#9B8E7C' },

  createCard:     { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, flexDirection: 'row', gap: 14, borderWidth: 2, borderColor: '#C8691A' },
  createIconWrap: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#C8691A', alignItems: 'center', justifyContent: 'center' },
  createIcon:     { fontSize: 22, color: '#FAF7F0' },
  createBody:     { flex: 1 },
  createTitle:    { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: '#1C1C2E', marginBottom: 4 },
  createSub:      { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12.5, color: '#1C1C2E', lineHeight: 18, marginBottom: 8 },
  createCta:      { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: '#C8691A' },

  legal:     { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: '#9B8E7C', textAlign: 'center', marginTop: 20, lineHeight: 18 },
});
