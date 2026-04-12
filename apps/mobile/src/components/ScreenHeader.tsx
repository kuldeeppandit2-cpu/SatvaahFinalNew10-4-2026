/**
 * ScreenHeader — shared back-button header used on every non-root screen.
 *
 * Usage:
 *   <ScreenHeader title="Notifications" onBack={() => navigation.goBack()} />
 *   <ScreenHeader title="My Subscription" onBack={() => navigation.goBack()} right={<SomeButton />} />
 *
 * Rules (per product spec):
 *  - Always top-left chevron-back
 *  - hitSlop 12px on all sides (easy to tap)
 *  - Title centred between back button and optional right action
 *  - 1px bottom border, ivory background
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;    // optional right-side action (e.g. Save button)
  subtitle?: string;          // optional subtitle below title
  noBorder?: boolean;         // for screens that use a full-bleed hero below header
}

export function ScreenHeader({
  title,
  onBack,
  right,
  subtitle,
  noBorder = false,
}: ScreenHeaderProps): React.ReactElement {
  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <View style={[styles.header, noBorder && styles.noBorder]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={24} color="#1C1C2E" />
        </TouchableOpacity>

        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>

        <View style={styles.right}>
          {right ?? null}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 4,
    paddingVertical:   10,
    backgroundColor:   '#FAF7F0',
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D5',
  },
  noBorder: {
    borderBottomWidth: 0,
  },
  backBtn: {
    width:           44,
    height:          44,
    alignItems:      'center',
    justifyContent:  'center',
  },
  titleBlock: {
    flex:  1,
    alignItems: 'center',
  },
  title: {
    fontSize:   17,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color:      '#1C1C2E',
  },
  subtitle: {
    fontSize:   12,
    fontFamily: 'PlusJakartaSans-Regular',
    color:      '#9E9589',
    marginTop:  1,
  },
  right: {
    width:           44,
    height:          44,
    alignItems:      'center',
    justifyContent:  'center',
  },
});
