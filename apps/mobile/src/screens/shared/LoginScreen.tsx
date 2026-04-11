/**
 * SatvAAh Login — Ivory background, Deep Ink text, Saffron CTA
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import auth from '../../__stubs__/firebase-auth';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

export function LoginScreen(): React.ReactElement {
  const navigation = useNavigation<Nav>();
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isValid = phone.length === 10 && /^[6-9]\d{9}$/.test(phone);

  async function handleSendCode() {
    if (!isValid || isLoading) return;
    setIsLoading(true);
    try {
      const e164 = `+91${phone}`;
      const confirmation = await auth().signInWithPhoneNumber(e164);
      navigation.navigate('Otp', { phone: e164, verificationId: confirmation.verificationId ?? '' });
    } catch (error: unknown) {
      Alert.alert('Error', (error as any)?.code === 'auth/too-many-requests'
        ? 'Too many requests. Please wait before trying again.'
        : 'Could not send verification code. Check your connection.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      <View style={s.header}>
        <View style={s.brandRow}>
          <Text style={s.brandInk}>Satv</Text>
          <View style={s.brandAA}><Text style={s.brandAAText}>AA</Text></View>
          <Text style={s.brandInk}>h</Text>
        </View>
        <Text style={s.tagline}>The Truth that travels</Text>
      </View>

      <View style={s.card}>
        <Text style={s.title}>Enter your mobile number</Text>
        <Text style={s.sub}>We'll send a 6-digit code to verify it's you.</Text>

        <View style={s.inputRow}>
          <View style={s.prefix}>
            <Text style={s.prefixText}>🇮🇳 +91</Text>
          </View>
          <TextInput
            style={s.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="10-digit number"
            placeholderTextColor="#C4B8A8"
            keyboardType="phone-pad"
            maxLength={10}
            autoFocus
          />
        </View>

        <TouchableOpacity
          style={[s.btn, !isValid && s.btnOff]}
          onPress={handleSendCode}
          disabled={!isValid || isLoading}
        >
          {isLoading
            ? <ActivityIndicator color="#FAF7F0" />
            : <Text style={s.btnText}>Send OTP →</Text>}
        </TouchableOpacity>

        <Text style={s.legal}>Zero commission. Always. By continuing you agree to our Terms & Privacy Policy.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: '#FAF7F0' },
  header:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  brandRow:   { flexDirection: 'row', alignItems: 'center' },
  brandInk:   { fontSize: 44, fontWeight: '800', color: '#1C1C2E' },
  brandAA:    { backgroundColor: '#C8691A', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, marginHorizontal: 1 },
  brandAAText:{ fontSize: 38, fontWeight: '800', color: '#FAF7F0' },
  tagline:    { fontSize: 11, fontWeight: '700', fontStyle: 'italic', color: '#C8691A', letterSpacing: 5, marginTop: 10 },
  card:       { backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 32, paddingBottom: 48, borderTopWidth: 1, borderColor: '#E8E0D5' },
  title:      { fontSize: 22, fontWeight: '700', color: '#1C1C2E', marginBottom: 8, fontFamily: 'PlusJakartaSans-Bold' },
  sub:        { fontSize: 14, color: '#1C1C2E', marginBottom: 28, lineHeight: 20, fontFamily: 'PlusJakartaSans-Regular' },
  inputRow:   { flexDirection: 'row', borderWidth: 1.5, borderColor: '#E8E0D5', borderRadius: 14, overflow: 'hidden', marginBottom: 20 },
  prefix:     { backgroundColor: '#FAF7F0', paddingHorizontal: 16, justifyContent: 'center', borderRightWidth: 1.5, borderRightColor: '#E8E0D5' },
  prefixText: { fontSize: 15, color: '#1C1C2E', fontWeight: '600', fontFamily: 'PlusJakartaSans-SemiBold' },
  input:      { flex: 1, paddingHorizontal: 16, paddingVertical: 16, fontSize: 20, color: '#1C1C2E', letterSpacing: 3, fontFamily: 'PlusJakartaSans-SemiBold' },
  btn:        { backgroundColor: '#C8691A', borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 20 },
  btnOff:     { backgroundColor: '#E8E0D5' },
  btnText:    { fontSize: 16, fontWeight: '700', color: '#FAF7F0', fontFamily: 'PlusJakartaSans-Bold' },
  legal:      { fontSize: 11, color: '#1C1C2E', textAlign: 'center', lineHeight: 16, fontFamily: 'PlusJakartaSans-Regular' },
});
