/**
 * SatvAAh OTP — Ivory bg, Deep Ink text, Saffron CTA, 6 boxes
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 View, Text, TextInput, TouchableOpacity, StyleSheet,
 StatusBar, KeyboardAvoidingView, Platform, Alert,
 ActivityIndicator, Animated,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import auth from '../../__stubs__/firebase-auth';
import type { AuthStackParamList } from '../../navigation/types';
import type { AuthScreenProps } from '../../navigation/types';

type OtpNav = NativeStackNavigationProp<AuthStackParamList, 'Otp'>;
type OtpRouteProps = AuthScreenProps<'Otp'>['route'];
const OTP_LENGTH = 6;

export function OtpScreen(): React.ReactElement {
  const navigation = useNavigation<OtpNav>();
  const route = useRoute<OtpRouteProps>();
  const { phone, verificationId } = route.params;
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const inputs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  function shake() {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  const handleChange = useCallback((val: string, idx: number) => {
    const digit = val.replace(/[^0-9]/g, '').slice(-1);
    const next = [...otp]; next[idx] = digit; setOtp(next);
    if (digit && idx < OTP_LENGTH - 1) inputs.current[idx + 1]?.focus();
    // Auto-verify removed — user must tap Verify button explicitly
  }, [otp]);

  function handleBackspace(idx: number) {
    if (otp[idx] === '' && idx > 0) {
      inputs.current[idx - 1]?.focus();
      const next = [...otp]; next[idx - 1] = ''; setOtp(next);
    }
  }

  async function verify(code?: string) {
    const otpCode = code ?? otp.join('');
    if (otpCode.length < OTP_LENGTH || isLoading) return;
    setIsLoading(true);
    try {
      const credential = auth.PhoneAuthProvider.credential(verificationId, otpCode);
      const result = await auth().signInWithCredential(credential);
      const token = await result.user?.getIdToken();
      navigation.replace('ModeSelection', {
        firebaseIdToken: token ?? 'MOCK_FIREBASE_TOKEN_FOR_TESTING',
        phone,
      });
    } catch {
      shake();
      setOtp(Array(OTP_LENGTH).fill(''));
      inputs.current[0]?.focus();
      Alert.alert('Invalid Code', 'The code you entered is incorrect. Please try again.');
    } finally { setIsLoading(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top', 'bottom']}>

    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.brandRow}>
          <Text style={s.brandInk}>Satv</Text>
          <View style={s.brandAA}><Text style={s.brandAAText}>AA</Text></View>
          <Text style={s.brandInk}>h</Text>
        </View>
        <Text style={s.tagline}>Verify your number</Text>
      </View>

      <View style={s.card}>
        <Text style={s.title}>Enter the 6-digit code</Text>
        <Text style={s.sub}>Sent to {phone}</Text>

        <Animated.View style={[s.boxes, { transform: [{ translateX: shakeAnim }] }]}>
          {otp.map((digit, i) => (
            <TextInput
              key={i}
              ref={r => { inputs.current[i] = r; }}
              style={[s.box, digit !== '' && s.boxFilled]}
              value={digit}
              onChangeText={v => handleChange(v, i)}
              onKeyPress={({ nativeEvent }) => nativeEvent.key === 'Backspace' && handleBackspace(i)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
            />
          ))}
        </Animated.View>

        {isLoading && (
          <View style={s.loadingRow}>
            <ActivityIndicator color="#C8691A" />
            <Text style={s.loadingText}>Verifying...</Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.btn, !otp.every(d => d !== '') && s.btnOff]}
          onPress={() => verify()}
          disabled={!otp.every(d => d !== '') || isLoading}
        >
          <Text style={s.btnText}>Verify →</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => { if (countdown <= 0) { setCountdown(60); setOtp(Array(OTP_LENGTH).fill(''));} }} disabled={countdown > 0}>
          <Text style={[s.resend, countdown <= 0 && s.resendActive]}>
            {countdown > 0 ? `Resend OTP in ${countdown}s` : 'Resend OTP'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#FAF7F0' },
  header:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backBtn:     { position: 'absolute', top: 60, left: 24 },
  backText:    { color: '#C8691A', fontSize: 16, fontWeight: '600', fontFamily: 'PlusJakartaSans-SemiBold' },
  brandRow:    { flexDirection: 'row', alignItems: 'center' },
  brandInk:    { fontSize: 44, fontWeight: '800', color: '#1C1C2E' },
  brandAA:     { backgroundColor: '#C8691A', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, marginHorizontal: 1 },
  brandAAText: { fontSize: 38, fontWeight: '800', color: '#FAF7F0' },
  tagline:     { fontSize: 11, fontWeight: '700', fontStyle: 'italic', color: '#C8691A', letterSpacing: 5, marginTop: 10 },
  card:        { backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 32, paddingBottom: 48, borderTopWidth: 1, borderColor: '#E8E0D5' },
  title:       { fontSize: 22, fontWeight: '700', color: '#1C1C2E', marginBottom: 8, fontFamily: 'PlusJakartaSans-Bold' },
  sub:         { fontSize: 14, color: '#1C1C2E', marginBottom: 28, fontFamily: 'PlusJakartaSans-Regular' },
  boxes:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28, gap: 8 },
  box:         { flex: 1, height: 60, borderWidth: 1.5, borderColor: '#E8E0D5', borderRadius: 12, textAlign: 'center', fontSize: 24, fontWeight: '700', color: '#1C1C2E', backgroundColor: '#FAF7F0', fontFamily: 'PlusJakartaSans-Bold' },
  boxFilled:   { borderColor: '#C8691A', backgroundColor: '#FFFFFF' },
  loadingRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16, gap: 8 },
  loadingText: { color: '#C8691A', fontSize: 14, fontFamily: 'PlusJakartaSans-Regular' },
  btn:         { backgroundColor: '#C8691A', borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 20 },
  btnOff:      { backgroundColor: '#E8E0D5' },
  btnText:     { fontSize: 16, fontWeight: '700', color: '#FAF7F0', fontFamily: 'PlusJakartaSans-Bold' },
  resend:      { textAlign: 'center', color: '#1C1C2E', fontSize: 14, fontFamily: 'PlusJakartaSans-Regular' },
  resendActive:{ color: '#C8691A', fontWeight: '600', fontFamily: 'PlusJakartaSans-SemiBold' },
});
