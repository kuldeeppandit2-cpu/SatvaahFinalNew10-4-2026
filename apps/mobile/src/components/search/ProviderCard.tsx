/**
 * ProviderCard.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Search result card layout:
 *   [Photo 80×80] [TrustRing] [Name, Category, Stars, Distance]
 *   [Availability dot] [Contact CTA]
 *
 * onContact → triggers ContactCallSheet / ContactMessageSheet.
 * onPress   → navigates to ProviderProfile.
 */

import React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import TrustRing from '../trust/TrustRing';
import TrustBadge from '../trust/TrustBadge';
import Avatar from '../common/Avatar';

const DEEP_INK   = '#1C1C2E';
const SAFFRON    = '#C8691A';
const VERDIGRIS  = '#2E7D72';
const IVORY      = '#FAF7F0';

// ─── Availability dot ─────────────────────────────────────────────────────────
type AvailabilityStatus = 'available' | 'busy' | 'offline';

const AVAIL_COLOUR: Record<AvailabilityStatus, string> = {
  available: '#22C55E',
  busy:      '#F59E0B',
  offline:   '#9CA3AF',
};

const AVAIL_LABEL: Record<AvailabilityStatus, string> = {
  available: 'Available now',
  busy:      'Busy',
  offline:   'Offline',
};

// ─── Star row ────────────────────────────────────────────────────────────────
const StarRow = ({ rating, count }: { rating: number; count: number }) => (
  <View style={styles.starRow}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Text
        key={n}
        style={[
          styles.star,
          { color: n <= Math.round(rating) ? SAFFRON : '#D1C9BC' },
        ]}
      >
        ★
      </Text>
    ))}
    <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
    <Text style={styles.ratingCount}>({count})</Text>
  </View>
);

// ─── Props ────────────────────────────────────────────────────────────────────
export interface ProviderCardData {
  id:           string;
  name:         string;
  category:     string;
  photoUrl?:    string;
  trustScore:   number;
  rating:       number;
  ratingCount:  number;
  distanceKm:   number;
  availability: AvailabilityStatus;
  isHomeVisit?: boolean;
  /** Whether provider is saved */
  isSaved?:     boolean;
}

interface ProviderCardProps {
  data:      ProviderCardData;
  onPress:   () => void;
  onContact: () => void;
  onSave?:   () => void;
  style?:    ViewStyle;
}

// ─── Component ────────────────────────────────────────────────────────────────
const ProviderCard: React.FC<ProviderCardProps> = ({
  data,
  onPress,
  onContact,
  onSave,
  style,
}) => {
  const {
    name, category, photoUrl, trustScore,
    rating, ratingCount, distanceKm, availability, isHomeVisit, isSaved,
  } = data;

  const distLabel = distanceKm < 1
    ? `${Math.round(distanceKm * 1000)} m`
    : `${distanceKm.toFixed(1)} km`;

  return (
    <TouchableOpacity
      style={[styles.card, style]}
      onPress={onPress}
      activeOpacity={0.90}
    >
      {/* Photo + Ring */}
      <View style={styles.photoWrap}>
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.photo}
            resizeMode="cover"
          />
        ) : (
          <Avatar name={name} size={80} />
        )}
        {/* TrustRing overlaid at bottom-right of photo */}
        <View style={styles.ringOverlay}>
          <TrustRing score={trustScore} size={60} animated />
          <Text style={styles.ringScore}>{trustScore}</Text>
        </View>
      </View>

      {/* Details */}
      <View style={styles.details}>
        {/* Name + save */}
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {onSave && (
            <TouchableOpacity onPress={onSave} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.saveIcon}>{isSaved ? '❤️' : '🤍'}</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.category} numberOfLines={1}>{category}</Text>

        <StarRow rating={rating} count={ratingCount} />

        {/* Meta row */}
        <View style={styles.metaRow}>
          {/* Availability */}
          <View style={styles.availRow}>
            <View
              style={[
                styles.availDot,
                { backgroundColor: AVAIL_COLOUR[availability] },
              ]}
            />
            <Text style={styles.availText}>{AVAIL_LABEL[availability]}</Text>
          </View>

          {/* Distance */}
          <Text style={styles.distance}>📍 {distLabel}</Text>

          {/* Home visit badge */}
          {isHomeVisit && (
            <View style={styles.homeBadge}>
              <Text style={styles.homeText}>Home visit</Text>
            </View>
          )}
        </View>

        {/* Trust badge */}
        <TrustBadge score={trustScore} variant="compact" />
      </View>

      {/* Contact CTA */}
      <TouchableOpacity
        style={styles.ctaButton}
        onPress={onContact}
        activeOpacity={0.85}
      >
        <Text style={styles.ctaText}>Contact</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    padding:         14,
    marginHorizontal: 16,
    marginVertical:   6,
    shadowColor:     DEEP_INK,
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.07,
    shadowRadius:    8,
    elevation:       3,
    gap:             12,
  },
  photoWrap: {
    position:     'relative',
    width:        80,
    height:       80,
    flexShrink:   0,
  },
  photo: {
    width:        80,
    height:       80,
    borderRadius: 12,
  },
  ringOverlay: {
    position:       'absolute',
    bottom:         -10,
    right:          -10,
    width:          36,
    height:         36,
    alignItems:     'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius:   18,
    shadowColor:    DEEP_INK,
    shadowOffset:   { width: 0, height: 1 },
    shadowOpacity:  0.10,
    shadowRadius:   3,
    elevation:      2,
  },
  ringScore: {
    position:   'absolute',
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   9,
    color:      DEEP_INK,
  },
  details: {
    flex: 1,
    gap:  3,
  },
  nameRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  name: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      DEEP_INK,
    flex:       1,
  },
  saveIcon: {
    fontSize:   16,
    marginLeft: 4,
  },
  category: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      '#9E9890',
  },
  starRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           1,
    marginTop:     2,
  },
  star: {
    fontSize: 12,
  },
  ratingText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    color:      SAFFRON,
    marginLeft: 3,
  },
  ratingCount: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#9E9890',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    flexWrap:      'wrap',
  },
  availRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  availDot: {
    width:        7,
    height:       7,
    borderRadius: 4,
  },
  availText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#6B6560',
  },
  distance: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#9E9890',
  },
  homeBadge: {
    backgroundColor: VERDIGRIS + '15',
    borderRadius:    6,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  homeText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   10,
    color:      VERDIGRIS,
  },
  ctaButton: {
    backgroundColor:  SAFFRON,
    borderRadius:     20,
    paddingHorizontal: 14,
    paddingVertical:   8,
    alignSelf:        'center',
    flexShrink:       0,
  },
  ctaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      '#FFFFFF',
  },
});

export default ProviderCard;
