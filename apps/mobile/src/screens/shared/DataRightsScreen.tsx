import React from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../../constants/colors';

export function DataRightsScreen() {
  const navigation = useNavigation();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>
    <ScreenHeader title="Privacy & Data Rights" onBack={() => navigation.goBack()} />
    <View style={styles.container}>
      <Text style={styles.title}>Data Rights</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
    </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.ivory },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.deepInk, marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#888', marginBottom: 32 },
  back: { paddingHorizontal: 24, paddingVertical: 12, backgroundColor: COLORS.verdigris, borderRadius: 8 },
  backText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
