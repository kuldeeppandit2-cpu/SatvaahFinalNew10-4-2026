'use client';
import { useEffect, useState } from 'react';
import { adminApi, City, NewCityPayload } from '@/lib/adminClient';

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Delhi (NCT)','Jammu & Kashmir','Ladakh','Chandigarh','Puducherry',
  'Andaman & Nicobar Islands','Dadra & Nagar Haveli','Daman & Diu','Lakshadweep',
];

const COUNTRIES = [
  { code: 'IND', label: '🇮🇳 India' },
  { code: 'SGP', label: '🇸🇬 Singapore' },
  { code: 'ARE', label: '🇦🇪 UAE' },
  { code: 'GBR', label: '🇬🇧 UK' },
  { code: 'USA', label: '🇺🇸 USA' },
];

const ACTIVE_FILTER = [
  { value: 'all',    label: 'All Cities' },
  { value: 'active', label: '✓ Active' },
  { value: 'inactive', label: '○ Inactive' },
];

export default function CitiesPage() {
  const [cities, setCities]       = useState<City[]>([]);
  const [filter, setFilter]       = useState('all');
  const [countryFilter, setCountryFilter] = useState('');
  const [form, setForm]           = useState<NewCityPayload & { is_launch_city: boolean }>({
    name: '', state: '', slug: '', country_code: 'IND', is_launch_city: false,
  });
  const [adding, setAdding]       = useState(false);
  const [toggling, setToggling]   = useState<string | null>(null);
  const [error, setError]         = useState('');

  useEffect(() => { adminApi.getCities().then(setCities).catch(e => setError(e.message)); }, []);

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  async function addCity(e: React.FormEvent) {
    e.preventDefault();
    if (!form.state) { setError('Please select a state.'); return; }
    setAdding(true); setError('');
    try {
      const city = await adminApi.addCity({
        name: form.name, state: form.state, slug: form.slug, country_code: form.country_code,
      });
      // If is_launch_city, update it
      if (form.is_launch_city) {
        await adminApi.updateCity(city.id, { is_launch_city: true });
        city.is_launch_city = true;
      }
      setCities(prev => [...prev, city]);
      setForm({ name: '', state: '', slug: '', country_code: 'IND', is_launch_city: false });
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setAdding(false); }
  }

  async function toggleActive(city: City) {
    setToggling(city.id);
    try {
      const updated = await adminApi.updateCity(city.id, { is_active: !city.is_active });
      setCities(prev => prev.map(c => c.id === city.id ? updated : c));
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setToggling(null); }
  }

  async function toggleLaunch(city: City) {
    setToggling(city.id + '_launch');
    try {
      const updated = await adminApi.updateCity(city.id, { is_launch_city: !city.is_launch_city });
      setCities(prev => prev.map(c => c.id === city.id ? updated : c));
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setToggling(null); }
  }

  const filtered = cities
    .filter(c => filter === 'all' ? true : filter === 'active' ? c.is_active : !c.is_active)
    .filter(c => countryFilter ? c.country_code === countryFilter : true);

  const active = cities.filter(c => c.is_active).length;
  const launch = cities.filter(c => c.is_launch_city).length;

  const selectCls = 'px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-verdigris w-full';

  return (
    <div>
      <h1 className="text-2xl font-bold text-deep-ink mb-1">Launch Cities</h1>
      <p className="text-gray-400 text-sm mb-5">
        {cities.length} cities · <span className="text-verdigris font-medium">{active} active</span>
        {' '}· <span className="text-saffron font-medium">{launch} launch cities</span>
      </p>
      {error && <div className="text-terracotta p-3 bg-red-50 rounded-xl text-sm mb-4">{error}</div>}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {ACTIVE_FILTER.map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                filter === f.value ? 'bg-white text-deep-ink shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}>{f.label}</button>
          ))}
        </div>
        <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-verdigris cursor-pointer">
          <option value="">All Countries</option>
          {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
      </div>

      {/* City list */}
      <div className="flex flex-col gap-2 mb-8">
        {filtered.length === 0 && (
          <div className="text-gray-400 text-sm py-4">No cities match the filter.</div>
        )}
        {filtered.map(city => (
          <div key={city.id} className={`bg-white rounded-xl border shadow-sm px-5 py-4 flex items-center gap-4 transition-colors ${
            city.is_active ? 'border-verdigris/20' : 'border-gray-100 opacity-70'
          }`}>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-deep-ink">{city.name}</span>
                <span className="text-xs text-gray-400">{city.state}</span>
                {city.is_launch_city && (
                  <span className="text-xs bg-saffron/10 text-saffron px-2 py-0.5 rounded-full font-medium">🚀 Launch</span>
                )}
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{city.country_code}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5 font-mono">{city.slug}</div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              {/* Launch city toggle */}
              <button onClick={() => toggleLaunch(city)}
                disabled={toggling === city.id + '_launch'}
                title={city.is_launch_city ? 'Remove from launch cities' : 'Mark as launch city'}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 ${
                  city.is_launch_city
                    ? 'border-saffron/30 text-saffron bg-saffron/5 hover:bg-saffron/10'
                    : 'border-gray-200 text-gray-400 hover:border-saffron/30 hover:text-saffron'
                }`}>
                {city.is_launch_city ? '🚀 Launch' : '＋ Set Launch'}
              </button>
              {/* Active toggle */}
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${city.is_active ? 'text-verdigris' : 'text-gray-400'}`}>
                  {city.is_active ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => toggleActive(city)} disabled={toggling === city.id}
                  className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${city.is_active ? 'bg-verdigris' : 'bg-gray-200'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${city.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add city form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-lg">
        <h2 className="font-semibold text-deep-ink mb-1">Add a New City</h2>
        <p className="text-xs text-gray-400 mb-4">Slug is auto-generated. City is inactive by default.</p>
        <form onSubmit={addCity} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">City Name *</label>
              <input required placeholder="e.g. Mumbai" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: autoSlug(e.target.value) }))}
                className={selectCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Slug (auto)</label>
              <input value={form.slug} readOnly
                className="px-3 py-2 border border-gray-100 rounded-lg text-sm bg-gray-50 w-full font-mono text-gray-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">State *</label>
              <select required value={form.state}
                onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                className={selectCls}>
                <option value="">Select state…</option>
                {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Country</label>
              <select value={form.country_code}
                onChange={e => setForm(f => ({ ...f, country_code: e.target.value }))}
                className={selectCls}>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <div className="relative">
              <input type="checkbox" className="sr-only" checked={form.is_launch_city}
                onChange={e => setForm(f => ({ ...f, is_launch_city: e.target.checked }))} />
              <div className={`w-10 h-6 rounded-full transition-colors ${form.is_launch_city ? 'bg-saffron' : 'bg-gray-200'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_launch_city ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
            </div>
            <span className="text-sm text-gray-700">Mark as launch city 🚀</span>
          </label>

          <button type="submit" disabled={adding}
            className="w-full py-2.5 bg-verdigris text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-green-800 transition-colors mt-1">
            {adding ? 'Adding…' : 'Add City'}
          </button>
        </form>
      </div>
    </div>
  );
}
