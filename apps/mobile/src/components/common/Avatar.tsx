/**
 * Avatar.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Circular avatar with photo support and initials fallback.
 * Deterministic colour per name (consistent across renders).
 * Optional status dot, size variants, onPress handler.
 */

import React, { useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';

// ─── Colour palette for initials backgrounds ──────────────────────────────────
const AVATAR_COLOURS = [
  '#2E7D72', // Verdigris
  '#C8691A', // Saffron
  '#6BA89E', // Light Verdigris
  '#4A7B8C', // Slate teal
  '#7B6B8C', // Muted mauve
  '#8C6B4A', // Warm brown
  '#4A6B8C', // Slate blue
  '#8C4A4A', // Dusty rose
];

function getInitialsColour(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || name.trim() === '') return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ─── Status dot ───────────────────────────────────────────────────────────────
type StatusType = 'online' | 'offline' | 'busy' | 'away';

const STATUS_COLOUR: Record<StatusType, string> = {
  online:  '#22C55E',
  offline: '#9CA3AF',
  busy:    '#F59E0B',
  away:    '#FB923C',
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface AvatarProps {
  name:       string;
  photoUrl?:  string | null;
  size?:      number;             // default 40
  status?:    StatusType;
  onPress?:   () => void;
  style?:     ViewStyle;
  /** Show online ring instead of dot */
  ringStatus?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
const Avatar: React.FC<AvatarProps> = ({
  name,
  photoUrl,
  size = 40,
  status,
  onPress,
  style,
  ringStatus = false,
}) => {
  const [imgError, setImgError] = useState(false);
  const showPhoto  = photoUrl && !imgError;
  const initials   = getInitials(name);
  const bg         = getInitialsColour(name);
  const fontSize   = Math.max(10, Math.round(size * 0.36));
  const br         = size / 2;
  const dotSize    = Math.max(8, Math.round(size * 0.24));

  const inner = (
    <View
      style={[
        styles.circle,
        {
          width:        size,
          height:       size,
          borderRadius: br,
          backgroundColor: showPhoto ? 'transparent' : bg,
        },
        ringStatus && status
          ? { borderWidth: 2.5, borderColor: STATUS_COLOUR[status] }
          : undefined,
        style,
      ]}
    >
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl! }}
          style={{ width: size, height: size, borderRadius: br }}
          onError={() => setImgError(true)}
          resizeMode="cover"
        />
      ) : (
        <Text style={[styles.initials, { fontSize, color: '#FFFFFF' }]}>
          {initials}
        </Text>
      )}

      {/* Status dot */}
      {status && !ringStatus && (
        <View
          style={[
            styles.dot,
            {
              width:       dotSize,
              height:      dotSize,
              borderRadius: dotSize / 2,
              bottom:      0,
              right:       0,
              backgroundColor: STATUS_COLOUR[status],
              borderWidth: Math.max(1.5, dotSize * 0.2),
              borderColor: '#FFFFFF',
            },
          ]}
        />
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        {inner}
      </TouchableOpacity>
    );
  }

  return inner;
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  circle: {
    alignItems:     'center',
    justifyContent: 'center',
    overflow:       'hidden',
  },
  initials: {
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  dot: {
    position:  'absolute',
  },
});

export default Avatar;
