/**
 * LocationPickerScreen
 *
 * Full screen shown after user taps L4 in S1, or from "Change" in SearchResults.
 * User picks their location before search fires.
 *
 * Options:
 *   1. Use current GPS location
 *   2. Pick from major Indian cities (instant — no API needed)
 *   3. Type any city name (Expo Location geocode, fallback to city list match)
 *
 * On confirm → stores coords → navigates to SearchResults with taxonomy params
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert,,
  StatusBar,} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useLocationStore } from '../../stores/location.store';
import { COLORS } from '../../constants/colors';

// ─── Major Indian cities with coords ─────────────────────────────────────────

const CITIES = [
  { name: 'Hyderabad',     lat: 17.385,  lng: 78.4867 },
  { name: 'Secunderabad',  lat: 17.4399, lng: 78.4983 },
  { name: 'Mumbai',        lat: 19.076,  lng: 72.8777 },
  { name: 'Delhi',         lat: 28.6139, lng: 77.2090 },
  { name: 'Bengaluru',     lat: 12.9716, lng: 77.5946 },
  { name: 'Chennai',       lat: 13.0827, lng: 80.2707 },
  { name: 'Kolkata',       lat: 22.5726, lng: 88.3639 },
  { name: 'Pune',          lat: 18.5204, lng: 73.8567 },
  { name: 'Ahmedabad',     lat: 23.0225, lng: 72.5714 },
  { name: 'Jaipur',        lat: 26.9124, lng: 75.7873 },
  { name: 'Lucknow',       lat: 26.8467, lng: 80.9462 },
  { name: 'Surat',         lat: 21.1702, lng: 72.8311 },
  { name: 'Kanpur',        lat: 26.4499, lng: 80.3319 },
  { name: 'Nagpur',        lat: 21.1458, lng: 79.0882 },
  { name: 'Visakhapatnam', lat: 17.6868, lng: 83.2185 },
  { name: 'Indore',        lat: 22.7196, lng: 75.8577 },
  { name: 'Thane',         lat: 19.2183, lng: 72.9781 },
  { name: 'Bhopal',        lat: 23.2599, lng: 77.4126 },
  { name: 'Patna',         lat: 25.5941, lng: 85.1376 },
  { name: 'Vadodara',      lat: 22.3072, lng: 73.1812 },
  { name: 'Ghaziabad',     lat: 28.6692, lng: 77.4538 },
  { name: 'Ludhiana',      lat: 30.9010, lng: 75.8573 },
  { name: 'Agra',          lat: 27.1767, lng: 78.0081 },
  { name: 'Nashik',        lat: 19.9975, lng: 73.7898 },
  { name: 'Faridabad',     lat: 28.4089, lng: 77.3178 },
  { name: 'Meerut',        lat: 28.9845, lng: 77.7064 },
  { name: 'Rajkot',        lat: 22.3039, lng: 70.8022 },
  { name: 'Kalyan-Dombivli', lat: 19.2350, lng: 73.1292 },
  { name: 'Vasai-Virar',   lat: 19.3919, lng: 72.8397 },
  { name: 'Varanasi',      lat: 25.3176, lng: 82.9739 },
  { name: 'Srinagar',      lat: 34.0837, lng: 74.7973 },
  { name: 'Coimbatore',    lat: 11.0168, lng: 76.9558 },
  { name: 'Amritsar',      lat: 31.6340, lng: 74.8723 },
  { name: 'Kochi',         lat: 9.9312,  lng: 76.2673 },
  { name: 'Madurai',       lat: 9.9252,  lng: 78.1198 },
  { name: 'Chandigarh',    lat: 30.7333, lng: 76.7794 },
  { name: 'Guwahati',      lat: 26.1445, lng: 91.7362 },
];

// ─── Navigation types ─────────────────────────────────────────────────────────

type Params = {
  LocationPicker: {
    // Taxonomy params passed through from CategoryBrowse
    query: string;
    taxonomyNodeId?: string;
    taxonomyL4?: string;
    taxonomyL3?: string;
    taxonomyL2?: string;
    taxonomyL1?: string;
    tab: string;
    // If coming from SearchResults "Change" — go back instead of forward
    returnToSearch?: boolean;
  };
  SearchResults: {
    query: string;
    taxonomyNodeId?: string;
    taxonomyL4?: string;
    taxonomyL3?: string;
    taxonomyL2?: string;
    taxonomyL1?: string;
    tab: string;
    locationName: string;
  };
};

type Nav = NativeStackNavigationProp<Params>;
type Route = RouteProp<Params, 'LocationPicker'>;

// ─── Component ────────────────────────────────────────────────────────────────

export function LocationPickerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { query, taxonomyNodeId, taxonomyL4, taxonomyL3, taxonomyL2, taxonomyL1, tab, returnToSearch } = route.params;

  const setLocation = useLocationStore((s) => s.setLocation);
  const [search, setSearch] = useState('');
  const [locating, setLocating] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return CITIES;
    const q = search.trim().toLowerCase();
    return CITIES.filter(c => c.name.toLowerCase().includes(q));
  }, [search]);

  const confirmLocation = useCallback((lat: number, lng: number, name: string) => {
    setLocation({ lat, lng });
    if (returnToSearch) {
      navigation.goBack();
    } else {
      navigation.navigate('SearchResults', {
        query,
        taxonomyNodeId,
        taxonomyL4,
        taxonomyL3,
        taxonomyL2,
        taxonomyL1,
        tab: tab as any,
        locationName: name,
      });
    }
  }, [navigation, query, taxonomyNodeId, taxonomyL4, taxonomyL3, taxonomyL2, taxonomyL1, tab, returnToSearch, setLocation]);

  const handleGPS = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow location access to search near you.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      // Reverse geocode to get city name
      let cityName = 'Current Location';
      try {
        const [addr] = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        cityName = addr.city ?? addr.subregion ?? addr.region ?? 'Current Location';
      } catch {}
      confirmLocation(loc.coords.latitude, loc.coords.longitude, cityName);
    } catch {
      Alert.alert('Error', 'Could not get your location. Please pick a city.');
    } finally {
      setLocating(false);
    }
  }, [confirmLocation]);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.deepInk} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Where should we search?</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Context line */}
      <Text style={s.context}>
        Finding: <Text style={s.contextBold}>{taxonomyL4 ?? query}</Text>
      </Text>

      {/* GPS button */}
      <TouchableOpacity style={s.gpsBtn} onPress={handleGPS} disabled={locating}>
        {locating
          ? <ActivityIndicator color={COLORS.ivory} />
          : <>
              <Ionicons name="locate" size={20} color={COLORS.ivory} />
              <Text style={s.gpsBtnText}>Use my current location</Text>
            </>
        }
      </TouchableOpacity>

      {/* Divider */}
      <View style={s.dividerRow}>
        <View style={s.dividerLine} />
        <Text style={s.dividerText}>or choose a city</Text>
        <View style={s.dividerLine} />
      </View>

      {/* Search box */}
      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Search city..."
          placeholderTextColor={COLORS.muted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={COLORS.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* City list */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.name}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.cityRow}
            onPress={() => confirmLocation(item.lat, item.lng, item.name)}
            activeOpacity={0.7}
          >
            <Ionicons name="location-outline" size={18} color={COLORS.saffron} style={s.cityIcon} />
            <Text style={s.cityName}>{item.name}</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.mutedLight} />
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: COLORS.ivory },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle:   { fontSize: 17, fontWeight: '700', color: COLORS.deepInk },
  context:       { fontSize: 13, color: COLORS.muted, paddingHorizontal: 16, marginBottom: 16 },
  contextBold:   { fontWeight: '700', color: COLORS.saffron },
  gpsBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: COLORS.verdigris, borderRadius: 14, marginHorizontal: 16, paddingVertical: 16, marginBottom: 20 },
  gpsBtnText:    { fontSize: 16, fontWeight: '600', color: COLORS.ivory },
  dividerRow:    { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 16 },
  dividerLine:   { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText:   { fontSize: 12, color: COLORS.muted, marginHorizontal: 10 },
  searchBox:     { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  searchInput:   { flex: 1, fontSize: 15, color: COLORS.deepInk },
  cityRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, backgroundColor: COLORS.white },
  cityIcon:      { marginRight: 12 },
  cityName:      { flex: 1, fontSize: 15, color: COLORS.deepInk, fontWeight: '500' },
  sep:           { height: 1, backgroundColor: COLORS.border, marginLeft: 48 },
});
