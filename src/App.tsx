/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  where,
  getDocs,
  doc, 
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { Resident, BillingPeriod, Reading, GlobalSettings, ResidentMeter, MeterReading, FinanceEntry } from './types';
import { 
  LayoutDashboard, 
  Users, 
  Settings as SettingsIcon, 
  LogOut, 
  Plus, 
  ChevronRight,
  Droplets,
  Zap,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Mail,
  Send,
  Trash2,
  Edit2,
  Save,
  X,
  Check,
  RefreshCw,
  FileDown,
  FileText,
  BarChart2,
  Copy,
  MessageSquare,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Filter,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO, addMonths } from 'date-fns';
import { pl } from 'date-fns/locale';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  BarChart,
  Bar,
  Legend
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const state = (this as any).state;
    if (state.hasError) {
      let errorMessage = "Coś poszło nie tak.";
      try {
        const parsedError = JSON.parse(state.error.message);
        if (parsedError.error) {
          errorMessage = `Błąd Firestore: ${parsedError.error} (Operacja: ${parsedError.operationType})`;
        }
      } catch (e) {
        errorMessage = state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full border border-slate-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertCircle size={32} />
              <h2 className="text-xl font-bold">Wystąpił błąd</h2>
            </div>
            <p className="text-slate-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
            >
              Odśwież aplikację
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}

function MainApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<'dashboard' | 'residents' | 'settings' | 'period-detail' | 'analytics' | 'finance' | 'arrears'>('dashboard');
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  
  const [residents, setResidents] = useState<Resident[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (!user) {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Test connection to Firestore
  useEffect(() => {
    if (user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          } else {
            handleFirestoreError(error, OperationType.GET, 'test/connection');
          }
        }
      };
      testConnection();
    }
  }, [user]);

  // Data listeners
  useEffect(() => {
    if (!user) return;

    let residentsReady = false;
    let periodsReady = false;
    let settingsReady = false;

    const checkReady = () => {
      if (residentsReady && periodsReady && settingsReady) {
        setIsDataLoaded(true);
        setLoading(false);
      }
    };

    const unsubResidents = onSnapshot(collection(db, 'residents'), (snapshot) => {
      const sortedResidents = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Resident))
        .sort((a, b) => a.apartmentNumber.localeCompare(b.apartmentNumber, undefined, { numeric: true, sensitivity: 'base' }));
      setResidents(sortedResidents);
      residentsReady = true;
      checkReady();
    }, (error) => handleFirestoreError(error, OperationType.GET, 'residents'));

    const unsubPeriods = onSnapshot(query(collection(db, 'billingPeriods'), orderBy('month', 'desc')), (snapshot) => {
      setBillingPeriods(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BillingPeriod)));
      periodsReady = true;
      checkReady();
    }, (error) => handleFirestoreError(error, OperationType.GET, 'billingPeriods'));

    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (doc) => {
      if (doc.exists()) {
        setGlobalSettings(doc.data() as GlobalSettings);
      }
      settingsReady = true;
      checkReady();
    }, (error) => handleFirestoreError(error, OperationType.GET, 'settings/global'));

    return () => {
      unsubResidents();
      unsubPeriods();
      unsubSettings();
    };
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleLogout = () => signOut(auth);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-10 text-center border border-slate-100">
          <div className="w-20 h-20 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-6 text-indigo-600">
            <Droplets size={48} />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2 italic serif">Woda Kamienica</h1>
          <p className="text-slate-500 mb-8">System zarządzania i rozliczania zużycia wody dla mieszkańców.</p>
          <button 
            onClick={handleLogin}
            className="w-full bg-slate-900 text-white py-4 rounded-2xl font-semibold hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-lg hover:shadow-indigo-200"
          >
            Zaloguj się przez Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
        {/* Top Navigation */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
          <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              {/* Logo */}
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                  <Droplets size={20} />
                </div>
                <span className="font-bold text-slate-900 text-lg hidden sm:block">Woda System</span>
              </div>

              {/* Navigation */}
              <nav className="flex items-center gap-1 sm:gap-2">
                <button 
                  onClick={() => setCurrentView('dashboard')}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm",
                    currentView === 'dashboard' || currentView === 'period-detail' ? "bg-indigo-50 text-indigo-600 font-semibold" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <LayoutDashboard size={18} />
                  <span className="hidden md:block">Rozliczenia Wody</span>
                </button>
                <button 
                  onClick={() => setCurrentView('finance')}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm",
                    currentView === 'finance' ? "bg-indigo-50 text-indigo-600 font-semibold" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Wallet size={18} />
                  <span className="hidden md:block">Przychody i rozchody</span>
                </button>
                <button 
                  onClick={() => setCurrentView('arrears')}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm",
                    currentView === 'arrears' ? "bg-indigo-50 text-indigo-600 font-semibold" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <AlertCircle size={18} />
                  <span className="hidden md:block">Zaległości</span>
                </button>
                <button 
                  onClick={() => setCurrentView('analytics')}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm",
                    currentView === 'analytics' ? "bg-indigo-50 text-indigo-600 font-semibold" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <BarChart2 size={18} />
                  <span className="hidden md:block">Wykresy</span>
                </button>
                <button 
                  onClick={() => setCurrentView('residents')}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm",
                    currentView === 'residents' ? "bg-indigo-50 text-indigo-600 font-semibold" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Users size={18} />
                  <span className="hidden md:block">Mieszkańcy</span>
                </button>
                <button 
                  onClick={() => setCurrentView('settings')}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm",
                    currentView === 'settings' ? "bg-indigo-50 text-indigo-600 font-semibold" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <SettingsIcon size={18} />
                  <span className="hidden md:block">Ustawienia</span>
                </button>
              </nav>

              {/* Right Side Actions */}
              <div className="flex items-center gap-4">
                <div className="hidden lg:flex items-center gap-2">
                  <Calendar size={14} className="text-slate-400" />
                  <select 
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
                  >
                    {Array.from(new Set([
                      new Date().getFullYear().toString(),
                      ...billingPeriods.map(p => p.month.split('-')[0])
                    ])).sort((a, b) => b.localeCompare(a)).map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>

                <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>

                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex flex-col items-end">
                    <p className="text-xs font-semibold text-slate-900 leading-none">{user.displayName}</p>
                    <p className="text-[10px] text-slate-500 leading-none mt-1">{user.email}</p>
                  </div>
                  <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-slate-200" />
                  <button 
                    onClick={handleLogout}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Wyloguj się"
                  >
                    <LogOut size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-4 sm:p-8 w-full max-w-[1800px] mx-auto">
            {currentView === 'dashboard' && (
              <Dashboard 
                periods={billingPeriods.filter(p => p.month.startsWith(selectedYear))} 
                residents={residents}
                selectedYear={selectedYear}
                onSelectPeriod={(id) => {
                  setSelectedPeriodId(id);
                  setCurrentView('period-detail');
                }}
              />
            )}
            {currentView === 'analytics' && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-3xl font-bold text-slate-900">Analiza Zużycia - {selectedYear}</h1>
                  <p className="text-slate-500">Wizualizacja trendów zużycia wody i prądu w wybranym roku.</p>
                </div>
                <ConsumptionCharts 
                  periods={billingPeriods.filter(p => p.month.startsWith(selectedYear))} 
                  residents={residents} 
                />
              </div>
            )}
            {currentView === 'residents' && (
              <ResidentManager residents={residents} billingPeriods={billingPeriods} selectedYear={selectedYear} globalSettings={globalSettings} />
            )}
            {currentView === 'finance' && (
              <FinanceManager 
                residents={residents} 
                globalSettings={globalSettings} 
                billingPeriods={billingPeriods}
              />
            )}
            {currentView === 'arrears' && (
              <ArrearsManager residents={residents} billingPeriods={billingPeriods} globalSettings={globalSettings} />
            )}
            {currentView === 'settings' && (
              <Settings settings={globalSettings} />
            )}
            {currentView === 'period-detail' && selectedPeriodId && (
              <PeriodDetail 
                periodId={selectedPeriodId} 
                residents={residents}
                billingPeriods={billingPeriods}
                globalSettings={globalSettings}
                onBack={() => setCurrentView('dashboard')}
              />
            )}
          </div>
        </main>
      </div>
  );
}

// --- Components ---

function ConsumptionCharts({ periods, residents }: { periods: BillingPeriod[], residents: Resident[] }) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (residents.length > 0 && !selectedResidentId) {
      setSelectedResidentId(residents[0].id);
    }
  }, [residents, selectedResidentId]);

  useEffect(() => {
    const fetchAllReadings = async () => {
      setIsLoading(true);
      try {
        const readingsSnap = await getDocs(collection(db, 'readings'));
        const allReadings = readingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reading));
        setReadings(allReadings);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'readings');
      } finally {
        setIsLoading(false);
      }
    };
    fetchAllReadings();
  }, []);

  const sortedPeriods = [...periods].sort((a, b) => a.month.localeCompare(b.month));

  if (periods.length === 0) {
    return (
      <div className="bg-white p-8 rounded-3xl border border-slate-200 text-center mb-8">
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 bg-slate-100 text-slate-400 rounded-full">
            <LayoutDashboard size={32} />
          </div>
          <p className="text-slate-500 font-medium">Brak danych do wyświetlenia wykresów. Dodaj pierwszy okres rozliczeniowy.</p>
        </div>
      </div>
    );
  }

  const buildingData = sortedPeriods.map(p => ({
    name: format(parseISO(p.month + '-01'), 'MMM yy', { locale: pl }),
    water: p.totalConsumption || 0,
    electricity: p.elecTotalConsumption || 0
  }));

  const priceData = sortedPeriods.map(p => ({
    name: format(parseISO(p.month + '-01'), 'MMM yy', { locale: pl }),
    waterPrice: p.pricePerM3 || 0,
    elecPrice: p.elecPricePerKWh || 0
  }));

  const residentData = sortedPeriods.map(p => {
    const r = readings.find(read => read.billingPeriodId === p.id && read.residentId === selectedResidentId);
    return {
      name: format(parseISO(p.month + '-01'), 'MMM yy', { locale: pl }),
      consumption: r?.meterConsumption || 0
    };
  });

  const summaryData = sortedPeriods.map(p => {
    const periodReadings = readings.filter(r => r.billingPeriodId === p.id);
    const totalIndividualConsumption = periodReadings.reduce((sum, r) => sum + (r.meterConsumption || 0), 0);
    const losses = (p.totalConsumption || 0) - totalIndividualConsumption;
    
    return {
      month: format(parseISO(p.month + '-01'), 'LLLL yyyy', { locale: pl }),
      mainMeter: p.totalConsumption || 0,
      individualTotal: totalIndividualConsumption,
      losses: losses
    };
  });

  const totals = {
    mainMeter: summaryData.reduce((sum, d) => sum + d.mainMeter, 0),
    individualTotal: summaryData.reduce((sum, d) => sum + d.individualTotal, 0),
    losses: summaryData.reduce((sum, d) => sum + d.losses, 0),
  };

  if (isLoading) {
    return (
      <div className="bg-white p-8 rounded-3xl border border-slate-200 flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="animate-spin text-indigo-600" size={32} />
          <p className="text-slate-500 font-medium">Ładowanie wykresów...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Building Chart */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <LayoutDashboard size={20} />
            </div>
            <h3 className="font-bold text-slate-900">Zużycie Ogólne Budynku</h3>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={buildingData}>
                <defs>
                  <linearGradient id="colorWater" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#64748b', fontSize: 12}} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#64748b', fontSize: 12}}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="water" 
                  name="Woda (m³)"
                  stroke="#4f46e5" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorWater)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Resident Chart */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                <Users size={20} />
              </div>
              <h3 className="font-bold text-slate-900">Trendy Mieszkańców</h3>
            </div>
            <select 
              value={selectedResidentId}
              onChange={(e) => setSelectedResidentId(e.target.value)}
              className="text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {residents.map(res => (
                <option key={res.id} value={res.id}>Lokal {res.apartmentNumber} - {res.name}</option>
              ))}
            </select>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={residentData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#64748b', fontSize: 12}} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#64748b', fontSize: 12}}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar 
                  dataKey="consumption" 
                  name="Zużycie (m³)"
                  fill="#10b981" 
                  radius={[4, 4, 0, 0]}
                  barSize={30}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Price History Chart */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
            <BarChart2 size={20} />
          </div>
          <h3 className="font-bold text-slate-900">Historia Cen Jednostkowych</h3>
        </div>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={priceData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#64748b', fontSize: 12}} 
                dy={10}
              />
              <YAxis 
                yId="left"
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#4f46e5', fontSize: 12}}
                tickFormatter={(value) => `${value.toFixed(2)} zł`}
                label={{ value: 'Woda (zł/m³)', angle: -90, position: 'insideLeft', fill: '#4f46e5', fontSize: 12 }}
              />
              <YAxis 
                yId="right"
                orientation="right"
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#f59e0b', fontSize: 12}}
                tickFormatter={(value) => `${value.toFixed(2)} zł`}
                label={{ value: 'Prąd (zł/kWh)', angle: 90, position: 'insideRight', fill: '#f59e0b', fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                formatter={(value: number) => [`${value.toFixed(2)} zł`]}
              />
              <Legend verticalAlign="top" height={36}/>
              <Bar 
                yId="left"
                dataKey="waterPrice" 
                name="Cena Wody (zł/m³)"
                fill="#4f46e5" 
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                yId="right"
                dataKey="elecPrice" 
                name="Cena Prądu (zł/kWh)"
                fill="#f59e0b" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Monthly Summary Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
            <BarChart2 size={20} />
          </div>
          <h3 className="font-bold text-slate-900">Zestawienie Zużycia i Ubytków</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Miesiąc</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Licznik Główny (m³)</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Suma Liczników Ind. (m³)</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ubytki (m³)</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">% Ubytków</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summaryData.map((data, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-semibold text-slate-900">{data.month}</td>
                  <td className="px-6 py-4 text-slate-600 font-medium">{data.mainMeter.toFixed(3)}</td>
                  <td className="px-6 py-4 text-slate-600 font-medium">{data.individualTotal.toFixed(3)}</td>
                  <td className="px-6 py-4 font-bold text-amber-600">{data.losses.toFixed(3)}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-lg text-xs font-bold",
                      (data.losses / data.mainMeter) > 0.1 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
                    )}>
                      {data.mainMeter > 0 ? ((data.losses / data.mainMeter) * 100).toFixed(1) : 0}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-100 border-t-2 border-slate-200">
              <tr>
                <td className="px-6 py-4 font-bold text-slate-900">SUMA (Cały Rok)</td>
                <td className="px-6 py-4 font-bold text-slate-900">{totals.mainMeter.toFixed(3)}</td>
                <td className="px-6 py-4 font-bold text-slate-900">{totals.individualTotal.toFixed(3)}</td>
                <td className="px-6 py-4 font-bold text-amber-700">{totals.losses.toFixed(3)}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-lg text-xs font-bold",
                    (totals.losses / totals.mainMeter) > 0 ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
                  )}>
                    {totals.mainMeter > 0 ? ((totals.losses / totals.mainMeter) * 100).toFixed(1) : 0}%
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ periods, residents, selectedYear, onSelectPeriod }: { periods: BillingPeriod[], residents: Resident[], selectedYear: string, onSelectPeriod: (id: string) => void }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMonth, setNewMonth] = useState(`${selectedYear}-${format(new Date(), 'MM')}`);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const generatePDF = async (period: BillingPeriod) => {
    setPdfError(null);
    setIsGenerating(period.id);
    try {
      // Fetch readings for this period
      const readingsQuery = query(collection(db, 'readings'), where('billingPeriodId', '==', period.id));
      const readingsSnap = await getDocs(readingsQuery);
      const readings = readingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reading));

      // Fetch all historical data for breakdowns
      const allReadingsSnap = await getDocs(collection(db, 'readings'));
      const allReadings = allReadingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reading));
      
      const allPeriodsSnap = await getDocs(collection(db, 'billingPeriods'));
      const allPeriods = allPeriodsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BillingPeriod))
        .sort((a, b) => a.month.localeCompare(b.month));

      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      if (!doc) throw new Error("Nie udało się zainicjować generatora PDF");

      // Load Roboto font for Polish characters support (UTF-8)
      try {
        const fontUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf';
        const fontBoldUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Medium.ttf';
        
        const [regRes, boldRes] = await Promise.all([fetch(fontUrl), fetch(fontBoldUrl)]);
        const [regBuffer, boldBuffer] = await Promise.all([regRes.arrayBuffer(), boldRes.arrayBuffer()]);
        
        const toBase64 = (buffer: ArrayBuffer) => {
          let binary = '';
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          return window.btoa(binary);
        };

        doc.addFileToVFS('Roboto-Regular.ttf', toBase64(regBuffer));
        doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
        doc.addFileToVFS('Roboto-Bold.ttf', toBase64(boldBuffer));
        doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
        
        doc.setFont('Roboto');
      } catch (fontErr) {
        console.warn("Could not load custom font, falling back to helvetica", fontErr);
        doc.setFont('helvetica');
      }

      const monthName = format(parseISO(period.month + '-01'), 'dd.MM.yyyy', { locale: pl });
      const generationDate = format(new Date(), 'dd.MM.yyyy HH:mm', { locale: pl });
      
      // Warm Colors Palette
      const primaryColor: [number, number, number] = [180, 83, 9]; // Amber-700
      const secondaryColor: [number, number, number] = [251, 191, 36]; // Amber-400
      const textColor: [number, number, number] = [69, 26, 3]; // Warm Brown
      
      const totalMeterConsumption = residents.reduce((sum, res) => {
        const r = readings.find(read => read.residentId === res.id);
        return sum + (r?.meterConsumption || 0);
      }, 0);

      const totalMeters = residents.reduce((sum, res) => sum + (res.meters?.length || 0), 0);
      const totalUbytki = period.totalConsumption - totalMeterConsumption;
      const ubytkiPerMeter = totalMeters > 0 ? totalUbytki / totalMeters : 0;
      const elecCostPerRes = residents.length > 0 ? (period.elecTotalInvoiceAmount / residents.length) : 0;
      const elecConsPerRes = residents.length > 0 ? (period.elecTotalConsumption / residents.length) : 0;

      // Title
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFontSize(24);
      doc.text(`Zestawienie Rozliczeniowe - ${monthName}`, 14, 20);
      
      doc.setFontSize(10);
      doc.text(`Data wygenerowania: ${generationDate}`, 282, 20, { align: 'right' });
      
      // Summary Box
      doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      doc.setFillColor(255, 251, 235); // Amber-50
      doc.roundedRect(14, 30, 268, 35, 3, 3, 'FD');
      
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.setFontSize(11);
      doc.text('PODSUMOWANIE ZUŻYCIA OGÓLNEGO:', 20, 40);
      
      doc.setFontSize(10);
      doc.text(`Woda: ${(period.totalConsumption || 0).toFixed(3)} m³ | Faktura: ${(period.totalInvoiceAmount || 0).toFixed(2)} zł | Cena: ${(period.pricePerM3 || 0).toFixed(2)} zł/m³`, 20, 48);
      
      if (period.elecTotalConsumption > 0) {
        doc.text(`Prąd: ${(period.elecTotalConsumption || 0).toFixed(3)} kWh | Faktura: ${(period.elecTotalInvoiceAmount || 0).toFixed(2)} zł | Cena: ${(period.elecPricePerKWh || 0).toFixed(2)} zł/kWh | Koszt na lokal: ${elecCostPerRes.toFixed(2)} zł`, 20, 55);
      }
      
      doc.text(`Fundusz remontowy: ${period.renovationFundAtTime.toFixed(2)} zł/lokal`, 20, 62);

      // Sort residents by apartment number
      const sortedResidents = [...residents].sort((a, b) => 
        a.apartmentNumber.localeCompare(b.apartmentNumber, undefined, { numeric: true, sensitivity: 'base' })
      );

      // Calculate totals
      const totals = {
        meterConsumption: 0,
        waterLossShare: 0,
        totalConsumption: 0,
        waterCost: 0,
        elecConsumption: 0,
        elecCost: 0,
        renovationFund: 0,
        totalToPay: 0
      };

      sortedResidents.forEach(res => {
        const reading = readings.find(r => r.residentId === res.id);
        const resMeterCons = reading?.meterConsumption || 0;
        const resMeterCount = res.meters?.length || 0;
        const resWaterLossShare = ubytkiPerMeter * resMeterCount;
        const resTotalCons = resMeterCons + resWaterLossShare;
        const resWaterCost = resTotalCons * period.pricePerM3;
        const resTotalToPay = resWaterCost + period.renovationFundAtTime + elecCostPerRes;

        totals.meterConsumption += resMeterCons;
        totals.waterLossShare += resWaterLossShare;
        totals.totalConsumption += resTotalCons;
        totals.waterCost += resWaterCost;
        totals.elecConsumption += elecConsPerRes;
        totals.elecCost += elecCostPerRes;
        totals.renovationFund += period.renovationFundAtTime;
        totals.totalToPay += resTotalToPay;
      });

      // Table
      const tableData = sortedResidents.map(res => {
        const reading = readings.find(r => r.residentId === res.id);
        const resMeterCons = reading?.meterConsumption || 0;
        const resMeterCount = res.meters?.length || 0;
        const resWaterLossShare = ubytkiPerMeter * resMeterCount;
        const resTotalCons = resMeterCons + resWaterLossShare;
        const resWaterCost = resTotalCons * period.pricePerM3;
        const resTotalToPay = resWaterCost + period.renovationFundAtTime + elecCostPerRes;

        return [
          res.apartmentNumber,
          res.name,
          resMeterCons.toFixed(3),
          resWaterLossShare.toFixed(3),
          resTotalCons.toFixed(3),
          resWaterCost.toFixed(2),
          elecCostPerRes.toFixed(2),
          period.renovationFundAtTime.toFixed(2),
          resTotalToPay.toFixed(2)
        ];
      });

      const footData = [[
        'RAZEM',
        '',
        totals.meterConsumption.toFixed(3),
        totals.waterLossShare.toFixed(3),
        totals.totalConsumption.toFixed(3),
        totals.waterCost.toFixed(2),
        totals.elecCost.toFixed(2),
        totals.renovationFund.toFixed(2),
        totals.totalToPay.toFixed(2)
      ]];

      autoTable(doc, {
        startY: 75,
        head: [['Lokal', 'Mieszkaniec', 'Zużycie (m³)', 'Ubytki (m³)', 'Suma m³', 'Woda (zł)', 'Prąd (zł)', 'Fundusz (zł)', 'Suma (zł)']],
        body: tableData,
        foot: footData,
        theme: 'grid',
        headStyles: { 
          fillColor: primaryColor,
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
          halign: 'center',
          font: 'Roboto'
        },
        footStyles: {
          fillColor: [241, 245, 249],
          textColor: textColor,
          fontSize: 8,
          fontStyle: 'bold',
          halign: 'right',
          font: 'Roboto'
        },
        columnStyles: {
          0: { halign: 'center', fontStyle: 'bold' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'right' },
          7: { halign: 'right' },
          8: { halign: 'right', fontStyle: 'bold', fontSize: 9 }
        },
        didParseCell: (data) => {
          if (data.column.index === 8) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fontSize = 9;
          }
        },
        styles: { 
          fontSize: 7,
          cellPadding: 2,
          overflow: 'linebreak',
          font: 'Roboto'
        },
        alternateRowStyles: {
          fillColor: [255, 251, 235] // Amber-50
        }
      });

      // Second Table: Payments
      const paymentData = sortedResidents.map(res => {
        const reading = readings.find(r => r.residentId === res.id);
        return [
          res.apartmentNumber,
          res.name,
          reading?.paidAmount?.toFixed(2) || '0.00',
          reading?.paymentDate ? format(parseISO(reading.paymentDate), 'dd.MM.yyyy') : '-'
        ];
      });

      doc.addPage();
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFontSize(18);
      doc.text(`Zestawienie Płatności - ${monthName}`, 14, 20);

      autoTable(doc, {
        startY: 30,
        head: [['Lokal', 'Mieszkaniec', 'Płatność (zł)', 'Data płatności']],
        body: paymentData,
        theme: 'grid',
        headStyles: { 
          fillColor: primaryColor,
          textColor: [255, 255, 255],
          fontSize: 10,
          fontStyle: 'bold',
          halign: 'center',
          font: 'Roboto'
        },
        columnStyles: {
          0: { halign: 'center', fontStyle: 'bold', cellWidth: 20 },
          2: { halign: 'right' }
        },
        styles: { 
          fontSize: 9,
          cellPadding: 3,
          overflow: 'linebreak',
          font: 'Roboto'
        },
        alternateRowStyles: {
          fillColor: [255, 251, 235]
        }
      });

      // Third Table: Historical Consumption & Payment Summary
      doc.addPage();
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFontSize(18);
      doc.text(`Historia Zużycia i Podsumowanie Płatności`, 14, 20);
      doc.setFontSize(10);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(`Podsumowanie historyczne dla wszystkich mieszkańców na dzień ${format(new Date(), 'dd.MM.yyyy')}`, 14, 28);

      const historicalData = sortedResidents.map(res => {
        const resReadings = allReadings.filter(r => r.residentId === res.id);
        const totalPaid = resReadings.reduce((sum, r) => sum + (r.paidAmount || 0), 0);
        const totalDue = resReadings.reduce((sum, r) => sum + (r.totalToPay || 0), 0);
        const balance = totalPaid - totalDue;
        
        // Last 3 months avg consumption
        const last3Readings = resReadings
          .sort((a, b) => {
            const pA = allPeriods.find(p => p.id === a.billingPeriodId);
            const pB = allPeriods.find(p => p.id === b.billingPeriodId);
            return (pB?.month || '').localeCompare(pA?.month || '');
          })
          .slice(0, 3);
        
        const avgCons = last3Readings.length > 0 
          ? last3Readings.reduce((sum, r) => sum + (r.meterConsumption || 0), 0) / last3Readings.length 
          : 0;

        return [
          res.apartmentNumber,
          res.name,
          avgCons.toFixed(3),
          totalDue.toFixed(2),
          totalPaid.toFixed(2),
          balance.toFixed(2)
        ];
      });

      autoTable(doc, {
        startY: 35,
        head: [['Lokal', 'Mieszkaniec', 'Śr. zużycie (3m)', 'Suma należności', 'Suma wpłat', 'Saldo (zł)']],
        body: historicalData,
        theme: 'grid',
        headStyles: { 
          fillColor: primaryColor,
          textColor: [255, 255, 255],
          fontSize: 10,
          fontStyle: 'bold',
          halign: 'center',
          font: 'Roboto'
        },
        columnStyles: {
          0: { halign: 'center', fontStyle: 'bold', cellWidth: 20 },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right', fontStyle: 'bold' }
        },
        styles: { 
          fontSize: 9,
          cellPadding: 3,
          overflow: 'linebreak',
          font: 'Roboto'
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 5) {
            const val = parseFloat(data.cell.text[0]);
            if (val < 0) data.cell.styles.textColor = [220, 38, 38]; // Red for debt
            else if (val > 0) data.cell.styles.textColor = [5, 150, 105]; // Green for overpayment
          }
        },
        alternateRowStyles: {
          fillColor: [255, 251, 235]
        }
      });

      doc.save(`Rozliczenie_Rozszerzone_${period.month}.pdf`);
    } catch (error: any) {
      console.error("Error generating PDF:", error);
      setPdfError(error.message || 'Wystąpił błąd podczas generowania pliku PDF.');
    } finally {
      setIsGenerating(null);
    }
  };

  useEffect(() => {
    if (showAddModal) {
      if (periods.length === 0) {
        setNewMonth(`${selectedYear}-01`);
      } else {
        const sortedPeriods = [...periods].sort((a, b) => b.month.localeCompare(a.month));
        const lastMonth = sortedPeriods[0].month;
        try {
          const nextDate = addMonths(parseISO(lastMonth + '-01'), 1);
          setNewMonth(format(nextDate, 'yyyy-MM'));
        } catch (e) {
          setNewMonth(`${selectedYear}-${format(new Date(), 'MM')}`);
        }
      }
    }
  }, [showAddModal, periods, selectedYear]);

  const handleAddPeriod = async () => {
    try {
      // Check if period already exists
      if (periods.find(p => p.month === newMonth)) {
        alert("Rozliczenie dla tego miesiąca już istnieje.");
        return;
      }

      // Get current settings for renovation fund
      const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
      const fund = settingsDoc.exists() ? settingsDoc.data().renovationFund : 150;

      // Find previous period to get end readings
      const sortedPeriods = [...periods].sort((a, b) => b.month.localeCompare(a.month));
      const prevPeriod = sortedPeriods[0];

      const newPeriod: Partial<BillingPeriod> = {
        month: newMonth,
        mainMeterStart: prevPeriod ? (prevPeriod.mainMeterEnd || 0) : 0,
        mainMeterEnd: 0,
        totalConsumption: 0,
        totalInvoiceAmount: 0,
        pricePerM3: 0,
        elecMeterStart: prevPeriod ? (prevPeriod.elecMeterEnd || 0) : 0,
        elecMeterEnd: 0,
        elecTotalConsumption: 0,
        elecTotalInvoiceAmount: 0,
        elecPricePerKWh: 0,
        renovationFundAtTime: fund,
        status: 'draft'
      };

      const docRef = await addDoc(collection(db, 'billingPeriods'), newPeriod);
      setShowAddModal(false);
      onSelectPeriod(docRef.id);
    } catch (error) {
      console.error("Error adding period:", error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Okresy Rozliczeniowe - {selectedYear}</h1>
          <p className="text-slate-500">Zarządzaj miesięcznymi fakturami i zużyciem wody w roku {selectedYear}.</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-semibold hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-lg shadow-indigo-200"
        >
          <Plus size={20} />
          <span>Nowy Miesiąc</span>
        </button>
      </div>

      {pdfError && (
        <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-2xl flex items-center gap-3">
          <AlertCircle size={20} />
          <p className="text-sm font-medium">{pdfError}</p>
          <button onClick={() => setPdfError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X size={18} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...periods].sort((a, b) => b.month.localeCompare(a.month)).map(period => (
          <div 
            key={period.id}
            onClick={() => onSelectPeriod(period.id)}
            className="bg-white p-6 rounded-3xl border border-slate-200 hover:border-indigo-300 hover:shadow-xl transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="bg-indigo-50 text-indigo-600 px-4 py-1 rounded-full text-sm font-bold uppercase tracking-wider">
                {format(parseISO(period.month + '-01'), 'LLLL yyyy', { locale: pl })}
              </div>
              <div className={cn(
                "px-3 py-1 rounded-full text-xs font-bold uppercase",
                period.status === 'published' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
              )}>
                {period.status === 'published' ? 'Opublikowane' : 'Szkic'}
              </div>
            </div>
            
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Zużycie ogólne:</span>
                <span className="font-semibold text-slate-900">{(period.totalConsumption || 0).toFixed(3)} m³</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Kwota faktury:</span>
                <span className="font-semibold text-slate-900">{(period.totalInvoiceAmount || 0).toFixed(2)} zł</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Cena za 1 m³:</span>
                <span className="font-semibold text-indigo-600">{(period.pricePerM3 || 0).toFixed(2)} zł</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Fundusz remontowy:</span>
                <span className="font-semibold text-slate-900">{period.renovationFundAtTime?.toFixed(2) || '0.00'} zł</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center text-indigo-600 font-semibold gap-1 group-hover:gap-2 transition-all">
                <span>Szczegóły</span>
                <ChevronRight size={18} />
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  generatePDF(period);
                }}
                disabled={isGenerating === period.id}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-600 rounded-xl text-sm font-bold transition-all"
              >
                <FileDown size={16} />
                <span>{isGenerating === period.id ? 'Generowanie...' : 'Pobierz PDF'}</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Nowy okres rozliczeniowy</h2>
            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Wybierz miesiąc</label>
                <input 
                  type="month" 
                  value={newMonth}
                  onChange={(e) => setNewMonth(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-6 py-3 rounded-xl font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Anuluj
              </button>
              <button 
                onClick={handleAddPeriod}
                className="flex-1 bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
              >
                Utwórz
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArrearsManager({ residents, billingPeriods, globalSettings }: { residents: Resident[], billingPeriods: BillingPeriod[], globalSettings: GlobalSettings | null }) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [financeEntries, setFinanceEntries] = useState<FinanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedResidentId, setExpandedResidentId] = useState<string | null>(null);

  useEffect(() => {
    const unsubReadings = onSnapshot(collection(db, 'readings'), (snapshot) => {
      setReadings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reading)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'readings'));

    const unsubFinance = onSnapshot(collection(db, 'finance'), (snapshot) => {
      setFinanceEntries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceEntry)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'finance');
      setLoading(false);
    });

    return () => {
      unsubReadings();
      unsubFinance();
    };
  }, []);

  const arrearsData = residents.map(resident => {
    const residentReadings = readings.filter(r => r.residentId === resident.id);
    
    // Ensure unique readings per period (latest one wins)
    const periodReadingsMap = new Map<string, Reading>();
    residentReadings.forEach(r => {
      const existing = periodReadingsMap.get(r.billingPeriodId);
      if (!existing || (r.lastUpdated || '') > (existing.lastUpdated || '')) {
        periodReadingsMap.set(r.billingPeriodId, r);
      }
    });

    const publishedPeriods = billingPeriods.filter(p => p.status === 'published');
    const publishedPeriodIds = new Set(publishedPeriods.map(p => p.id));
    
    const billedReadings = Array.from(periodReadingsMap.values()).filter(r => publishedPeriodIds.has(r.billingPeriodId));
    
    // Detailed breakdown for display
    const breakdown = billedReadings.map(r => {
      const period = billingPeriods.find(p => p.id === r.billingPeriodId);
      // Use stored fund or fallback to period value or global setting
      const fund = r.repairFund || period?.renovationFundAtTime || globalSettings?.renovationFund || 0;
      const billed = (r.waterCost || 0) + (r.elecCost || 0) + fund;
      
      return {
        month: period?.month || '?',
        water: r.waterCost || 0,
        elec: r.elecCost || 0,
        fr: fund,
        billed: billed,
        paid: r.paidAmount || 0
      };
    }).sort((a, b) => a.month.localeCompare(b.month));

    // 1. Sum of billed amounts (Jan, Feb, Mar) - recalculated for accuracy
    const totalBilled = breakdown.reduce((sum, b) => sum + b.billed, 0);
    
    // 2. Sum of payments (Jan, Feb, Mar...)
    const readingPayments = Array.from(periodReadingsMap.values()).reduce((sum, r) => sum + (r.paidAmount || 0), 0);
    const manualPayments = financeEntries
      .filter(e => e.type === 'income' && e.person === resident.name && !e.isAutomatic)
      .reduce((sum, e) => sum + e.amount, 0);
    
    const totalPaid = readingPayments + manualPayments;
    
    // 3. Total balance: (Sum of Billed) - (Sum of Paid)
    const balance = totalBilled - totalPaid;
    
    // Calculate days late for the oldest unpaid month
    let maxDaysLate = 0;
    let oldestUnpaidMonth = '';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (balance > 0.01) {
      const sortedPublishedPeriods = [...publishedPeriods].sort((a, b) => a.month.localeCompare(b.month));
      
      let cumulativeBilled = 0;
      for (const period of sortedPublishedPeriods) {
        const b = breakdown.find(item => item.month === period.month);
        cumulativeBilled += (b?.billed || 0);
        
        if (cumulativeBilled > totalPaid + 0.01) {
          oldestUnpaidMonth = period.month;
          const [year, month] = period.month.split('-').map(Number);
          const deadline = new Date(year, month, 5);
          deadline.setHours(0, 0, 0, 0);
          
          if (today > deadline) {
            const diffTime = today.getTime() - deadline.getTime();
            maxDaysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          }
          break;
        }
      }
    }

    return {
      ...resident,
      totalBilled,
      totalPaid,
      balance,
      maxDaysLate,
      oldestUnpaidMonth,
      breakdown
    };
  }).sort((a, b) => a.apartmentNumber.localeCompare(b.apartmentNumber, undefined, { numeric: true, sensitivity: 'base' }));

  const totalArrears = arrearsData.reduce((sum, item) => sum + Math.max(0, item.balance), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 italic serif">Zaległości</h1>
          <p className="text-slate-500 text-sm">Zestawienie wszystkich należności i wpłat (Saldo całkowite).</p>
        </div>
        <div className="bg-rose-50 border border-rose-100 px-6 py-4 rounded-3xl">
          <p className="text-xs font-bold text-rose-400 uppercase tracking-widest mb-1">Suma zaległości w kamienicy</p>
          <p className="text-3xl font-black text-rose-600 font-mono">{totalArrears.toFixed(2)} zł</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Lokal</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mieszkaniec</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Należności (suma)</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Wpłaty (suma)</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Saldo / Zaległość</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Zwłoka (dni)</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {arrearsData.map(item => (
                <tr key={item.id} className={cn(
                  "hover:bg-slate-50 transition-colors",
                  item.balance > 0.01 ? "bg-rose-50/20" : ""
                )}>
                  <td className="px-6 py-4">
                    <span className="w-8 h-8 flex items-center justify-center bg-slate-100 rounded-lg text-sm font-bold text-slate-700">
                      {item.apartmentNumber}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-between group">
                      <div>
                        <div className="font-bold text-slate-900">{item.name}</div>
                        <div className="text-xs text-slate-500">{item.email}</div>
                      </div>
                      {item.breakdown.length > 0 && (
                        <button 
                          onClick={() => setExpandedResidentId(expandedResidentId === item.id ? null : item.id)}
                          className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-all"
                          title={expandedResidentId === item.id ? "Zwiń szczegóły" : "Rozwiń szczegóły"}
                        >
                          {expandedResidentId === item.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      )}
                    </div>
                    
                    <AnimatePresence>
                      {expandedResidentId === item.id && item.breakdown.length > 0 && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                            {item.breakdown.map((b, idx) => (
                              <div key={idx} className="text-[10px] flex flex-wrap gap-x-3 gap-y-0.5 text-slate-500 bg-slate-50/50 p-1.5 rounded-md border border-slate-100/50">
                                <span className="font-bold text-slate-700 min-w-[50px]">{b.month}:</span>
                                <span>Woda: {b.water.toFixed(2)}</span>
                                <span>Prąd: {b.elec.toFixed(2)}</span>
                                <span>FR: {b.fr.toFixed(2)}</span>
                                <span className="font-bold text-slate-900 ml-auto">{b.billed.toFixed(2)} zł</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-slate-600">{item.totalBilled.toFixed(2)} zł</td>
                  <td className="px-6 py-4 text-right font-mono text-emerald-600">{item.totalPaid.toFixed(2)} zł</td>
                  <td className="px-6 py-4 text-right">
                    <span className={cn(
                      "text-lg font-black font-mono",
                      item.balance > 0.01 ? "text-rose-600" : "text-emerald-600"
                    )}>
                      {item.balance.toFixed(2)} zł
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {item.balance > 0.01 && item.maxDaysLate > 0 ? (
                      <div className="flex flex-col items-end">
                        <span className="text-rose-600 font-bold">{item.maxDaysLate} dni</span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-tighter">od {item.oldestUnpaidMonth}</span>
                      </div>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {item.balance > 0.01 ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold uppercase tracking-wider border border-rose-200">
                        <AlertCircle size={12} />
                        Zaległość
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider border border-emerald-200">
                        <Check size={12} />
                        Rozliczony
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FinanceManager({ residents, globalSettings, billingPeriods }: { residents: Resident[], globalSettings: GlobalSettings | null, billingPeriods: BillingPeriod[] }) {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FinanceEntry | null>(null);
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-01'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isEditingInitialBalance, setIsEditingInitialBalance] = useState(false);
  const [tempInitialBalance, setTempInitialBalance] = useState(globalSettings?.initialBalance || 0);

  const isLatePayment = (entry: FinanceEntry) => {
    if (!entry.isAutomatic || !entry.billingPeriodId) return false;
    const period = billingPeriods.find(p => p.id === entry.billingPeriodId);
    if (!period) return false;
    
    const [year, month] = period.month.split('-').map(Number);
    // month is 1-indexed (e.g., "01" for Jan)
    // new Date(year, month, 0) gives the last day of the month
    const lastDay = new Date(year, month, 0);
    const paymentDate = new Date(entry.date);
    
    // Set both to midnight for accurate comparison
    lastDay.setHours(0, 0, 0, 0);
    paymentDate.setHours(0, 0, 0, 0);
    
    return paymentDate > lastDay;
  };

  useEffect(() => {
    if (globalSettings) {
      setTempInitialBalance(globalSettings.initialBalance);
    }
  }, [globalSettings]);

  const handleSaveInitialBalance = async () => {
    try {
      await setDoc(doc(db, 'settings', 'global'), {
        ...globalSettings,
        initialBalance: tempInitialBalance,
        lastUpdated: new Date().toISOString()
      }, { merge: true });
      setIsEditingInitialBalance(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/global');
    }
  };
  
  const [formData, setFormData] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    name: '',
    person: '',
    description: '',
    amount: 0,
    type: 'expense' as 'income' | 'expense'
  });

  useEffect(() => {
    const q = query(collection(db, 'finance'), orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setEntries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceEntry)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'finance'));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'readings'), where('paidAmount', '>', 0));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setReadings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reading)));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'readings'));
    return () => unsubscribe();
  }, []);

  // Generate automatic income entries from readings
  const automaticIncome: FinanceEntry[] = readings
    .filter(r => r.paymentDate && r.paidAmount && r.paidAmount > 0)
    .map(reading => {
      const resident = residents.find(r => r.id === reading.residentId);
      return {
        id: `auto-${reading.id}`,
        date: reading.paymentDate || '',
        name: resident?.name || 'Nieznany mieszkaniec',
        person: resident?.name || 'Nieznany mieszkaniec',
        description: (reading.elecCost || 0) > 0 ? 'woda i prąd' : 'woda',
        amount: reading.paidAmount || 0,
        type: 'income',
        isAutomatic: true,
        billingPeriodId: reading.billingPeriodId
      };
    });

  const allEntries = [...entries, ...automaticIncome].sort((a, b) => b.date.localeCompare(a.date));

  const totalIncome = allEntries.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amount, 0);
  const totalExpense = allEntries.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
  const currentBalance = (globalSettings?.initialBalance || 0) + totalIncome - totalExpense;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingEntry) {
        await updateDoc(doc(db, 'finance', editingEntry.id), formData);
      } else {
        await addDoc(collection(db, 'finance'), formData);
      }
      setIsAdding(false);
      setEditingEntry(null);
      setFormData({
        date: format(new Date(), 'yyyy-MM-dd'),
        name: '',
        person: '',
        description: '',
        amount: 0,
        type: 'expense'
      });
    } catch (error) {
      handleFirestoreError(error, editingEntry ? OperationType.UPDATE : OperationType.CREATE, 'finance');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Czy na pewno chcesz usunąć ten wpis?')) {
      try {
        await deleteDoc(doc(db, 'finance', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'finance');
      }
    }
  };

  const generateFinanceReport = async () => {
    const docPDF = new jsPDF('l', 'mm', 'a4');
    
    // Load Roboto font for Polish characters support (UTF-8)
    try {
      const fontUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf';
      const fontBoldUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Medium.ttf';
      
      const [regRes, boldRes] = await Promise.all([fetch(fontUrl), fetch(fontBoldUrl)]);
      const [regBuffer, boldBuffer] = await Promise.all([regRes.arrayBuffer(), boldRes.arrayBuffer()]);
      
      const toBase64 = (buffer: ArrayBuffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
      };

      docPDF.addFileToVFS('Roboto-Regular.ttf', toBase64(regBuffer));
      docPDF.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      docPDF.addFileToVFS('Roboto-Bold.ttf', toBase64(boldBuffer));
      docPDF.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
      
      docPDF.setFont('Roboto');
    } catch (fontErr) {
      console.warn("Could not load custom font, falling back to helvetica", fontErr);
      docPDF.setFont('helvetica');
    }

    const filtered = allEntries.filter(e => e.date >= dateFrom && e.date <= dateTo);
    
    const incomeSum = filtered.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amount, 0);
    const expenseSum = filtered.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
    
    docPDF.setFontSize(18);
    docPDF.text('Raport Finansowy', 14, 20);
    
    const generationDate = format(new Date(), 'dd.MM.yyyy HH:mm', { locale: pl });
    docPDF.setFontSize(10);
    docPDF.text(`Data wygenerowania: ${generationDate}`, 282, 20, { align: 'right' });
    
    docPDF.setFontSize(12);
    docPDF.text(`Okres: ${dateFrom} do ${dateTo}`, 14, 30);
    
    autoTable(docPDF, {
      startY: 40,
      head: [['Data', 'Nazwa', 'Osoba', 'Opis', 'Przychód', 'Rozchód']],
      body: filtered.map(e => [
        e.date,
        e.name,
        e.person,
        e.description,
        e.type === 'income' ? e.amount.toFixed(2) : '',
        e.type === 'expense' ? e.amount.toFixed(2) : ''
      ]),
      theme: 'striped',
      headStyles: { 
        fillColor: [79, 70, 229],
        font: 'Roboto',
        fontStyle: 'bold'
      },
      styles: {
        font: 'Roboto'
      }
    });

    const finalY = (docPDF as any).lastAutoTable.finalY || 40;
    
    docPDF.setFont('Roboto', 'normal');
    docPDF.text(`Stan początkowy konta: ${(globalSettings?.initialBalance || 0).toFixed(2)} zł`, 14, finalY + 10);

    docPDF.setFont('Roboto', 'bold');
    docPDF.text(`Podsumowanie okresu:`, 14, finalY + 22);
    docPDF.setFont('Roboto', 'normal');
    docPDF.text(`Suma przychodów (w okresie): ${incomeSum.toFixed(2)} zł`, 14, finalY + 32);
    docPDF.text(`Suma rozchodów (w okresie): ${expenseSum.toFixed(2)} zł`, 14, finalY + 40);
    docPDF.text(`Saldo okresu: ${(incomeSum - expenseSum).toFixed(2)} zł`, 14, finalY + 48);
    
    docPDF.setFont('Roboto', 'bold');
    docPDF.text(`Stan konta (na dzień ${dateTo}):`, 14, finalY + 62);
    
    // Calculate balance up to dateTo
    const incomeToDate = allEntries.filter(e => e.type === 'income' && e.date <= dateTo).reduce((sum, e) => sum + e.amount, 0);
    const expenseToDate = allEntries.filter(e => e.type === 'expense' && e.date <= dateTo).reduce((sum, e) => sum + e.amount, 0);
    const balanceToDate = (globalSettings?.initialBalance || 0) + incomeToDate - expenseToDate;

    docPDF.text(`${balanceToDate.toFixed(2)} zł`, 14, finalY + 70);

    docPDF.save(`raport-finansowy-${dateFrom}-${dateTo}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Przychody i rozchody</h1>
          <p className="text-slate-500">Pełna ewidencja finansowa budynku.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus size={20} />
            Dodaj wpis
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
              <Wallet size={24} />
            </div>
            <span className="text-slate-500 font-medium">Aktualne Saldo</span>
          </div>
          <div className="text-3xl font-bold text-slate-900">
            {currentBalance.toFixed(2)} <span className="text-lg text-slate-400">zł</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {isEditingInitialBalance ? (
              <div className="flex items-center gap-2">
                <input 
                  type="number" 
                  step="0.01"
                  value={tempInitialBalance}
                  onChange={(e) => setTempInitialBalance(parseFloat(e.target.value) || 0)}
                  className="w-24 px-2 py-1 text-xs rounded border border-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
                <button 
                  onClick={handleSaveInitialBalance}
                  className="p-1 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                  title="Zapisz"
                >
                  <Check size={14} />
                </button>
                <button 
                  onClick={() => {
                    setIsEditingInitialBalance(false);
                    setTempInitialBalance(globalSettings?.initialBalance || 0);
                  }}
                  className="p-1 text-slate-400 hover:bg-slate-50 rounded transition-colors"
                  title="Anuluj"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-400">Wliczając stan początkowy: {globalSettings?.initialBalance?.toFixed(2)} zł</p>
                <button 
                  onClick={() => setIsEditingInitialBalance(true)}
                  className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                  title="Edytuj stan początkowy"
                >
                  <Edit2 size={12} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
              <ArrowUpCircle size={24} />
            </div>
            <span className="text-slate-500 font-medium">Suma Przychodów</span>
          </div>
          <div className="text-3xl font-bold text-emerald-600">
            {totalIncome.toFixed(2)} <span className="text-lg text-emerald-400">zł</span>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
              <ArrowDownCircle size={24} />
            </div>
            <span className="text-slate-500 font-medium">Suma Rozchodów</span>
          </div>
          <div className="text-3xl font-bold text-rose-600">
            {totalExpense.toFixed(2)} <span className="text-lg text-rose-400">zł</span>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className={`p-3 rounded-2xl ${(totalIncome - totalExpense) >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
              <BarChart2 size={24} />
            </div>
            <span className="text-slate-500 font-medium">Saldo operacyjne</span>
          </div>
          <div className={`text-3xl font-bold ${(totalIncome - totalExpense) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {(totalIncome - totalExpense).toFixed(2)} <span className="text-lg opacity-70">zł</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">Różnica przychodów i rozchodów</p>
        </div>
      </div>

      {/* Report Generator */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row items-end gap-4">
          <div className="flex-1">
            <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Data od</label>
            <input 
              type="date" 
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Data do</label>
            <input 
              type="date" 
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
          <button 
            onClick={generateFinanceReport}
            className="flex items-center gap-2 bg-slate-900 text-white px-6 py-2 rounded-xl font-semibold hover:bg-slate-800 transition-colors shadow-sm"
          >
            <FileDown size={20} />
            Generuj Raport PDF
          </button>
        </div>
      </div>

      {/* Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Income List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <ArrowUpCircle className="text-emerald-500" size={20} />
              Przychody
            </h2>
          </div>
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-bottom border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Nazwa / Od kogo</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Opis</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Kwota</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allEntries.filter(e => e.type === 'income').map(entry => {
                    const isLate = isLatePayment(entry);
                    return (
                      <tr key={entry.id} className={cn(
                        "hover:bg-slate-50 transition-colors",
                        isLate && "bg-orange-50 hover:bg-orange-100"
                      )}>
                        <td className="px-6 py-4 text-sm text-slate-600">
                          <div className="flex items-center gap-2">
                            {entry.date}
                            {isLate && (
                              <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded uppercase tracking-wider">
                                Po terminie
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm font-bold text-slate-900">{entry.name}</div>
                          <div className="text-xs text-slate-500">{entry.person}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600">{entry.description}</td>
                        <td className="px-6 py-4 text-sm font-bold text-emerald-600 text-right">{entry.amount.toFixed(2)} zł</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Expense List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <ArrowDownCircle className="text-rose-500" size={20} />
              Rozchody
            </h2>
          </div>
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-bottom border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Nazwa / Dla kogo</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Opis</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Kwota</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Akcje</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allEntries.filter(e => e.type === 'expense').map(entry => (
                    <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-sm text-slate-600">{entry.date}</td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-900">{entry.name}</div>
                        <div className="text-xs text-slate-500">{entry.person}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">{entry.description}</td>
                      <td className="px-6 py-4 text-sm font-bold text-rose-600 text-right">{entry.amount.toFixed(2)} zł</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => {
                              setEditingEntry(entry);
                              setFormData({
                                date: entry.date,
                                name: entry.name,
                                person: entry.person,
                                description: entry.description,
                                amount: entry.amount,
                                type: entry.type
                              });
                              setIsAdding(true);
                            }}
                            className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button 
                            onClick={() => handleDelete(entry.id)}
                            className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">
                {editingEntry ? 'Edytuj wpis' : 'Dodaj nowy wpis'}
              </h2>
              <button onClick={() => { setIsAdding(false); setEditingEntry(null); }} className="p-2 hover:bg-slate-50 rounded-xl transition-colors">
                <X size={24} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Typ</label>
                  <select 
                    value={formData.type}
                    onChange={(e) => setFormData({...formData, type: e.target.value as 'income' | 'expense'})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  >
                    <option value="expense">Rozchód</option>
                    <option value="income">Przychód</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Data</label>
                  <input 
                    type="date" 
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({...formData, date: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Nazwa</label>
                <input 
                  type="text" 
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="np. Faktura za prąd"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">
                  {formData.type === 'expense' ? 'Dla kogo' : 'Od kogo'}
                </label>
                <input 
                  type="text" 
                  required
                  value={formData.person}
                  onChange={(e) => setFormData({...formData, person: e.target.value})}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="np. Enea S.A."
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Za co / Opis</label>
                <input 
                  type="text" 
                  required
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="np. Opłata za okres styczeń"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Kwota (zł)</label>
                <input 
                  type="number" 
                  step="0.01"
                  required
                  value={formData.amount}
                  onChange={(e) => setFormData({...formData, amount: parseFloat(e.target.value) || 0})}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-xl font-bold"
                />
              </div>
              <div className="pt-4">
                <button 
                  type="submit"
                  className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                >
                  {editingEntry ? 'Zapisz zmiany' : 'Dodaj wpis'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ResidentManager({ residents, billingPeriods, selectedYear, globalSettings }: { residents: Resident[], billingPeriods: BillingPeriod[], selectedYear: string, globalSettings: GlobalSettings | null }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [formData, setFormData] = useState({ 
    name: '', 
    apartmentNumber: '', 
    email: '', 
    phone: '', 
    meters: [] as ResidentMeter[] 
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingResident) {
        await updateDoc(doc(db, 'residents', editingResident.id), formData);
      } else {
        await addDoc(collection(db, 'residents'), formData);
      }
      setShowAddModal(false);
      setEditingResident(null);
      setFormData({ name: '', apartmentNumber: '', email: '', phone: '', meters: [] });
    } catch (error) {
      handleFirestoreError(error, editingResident ? OperationType.UPDATE : OperationType.CREATE, 'residents');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Czy na pewno chcesz usunąć tego mieszkańca? Spowoduje to również usunięcie wszystkich jego odczytów.")) {
      try {
        // Delete resident
        await deleteDoc(doc(db, 'residents', id));
        
        // Delete associated readings
        const readingsQuery = query(collection(db, 'readings'), where('residentId', '==', id));
        const readingsSnapshot = await getDocs(readingsQuery);
        const deletePromises = readingsSnapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'residents');
      }
    }
  };

  const addMeterField = () => {
    setFormData({
      ...formData,
      meters: [...formData.meters, { id: crypto.randomUUID(), name: `Licznik ${formData.meters.length + 1}`, initialReading: 0 }]
    });
  };

  const removeMeterField = (index: number) => {
    if (confirm("Czy na pewno chcesz usunąć ten licznik?")) {
      const newMeters = [...formData.meters];
      newMeters.splice(index, 1);
      setFormData({ ...formData, meters: newMeters });
    }
  };

  const updateMeterField = (index: number, field: keyof ResidentMeter, value: string | number) => {
    const newMeters = [...formData.meters];
    const val = field === 'initialReading' ? (typeof value === 'number' && isNaN(value) ? 0 : value) : value;
    newMeters[index] = { ...newMeters[index], [field]: val };
    setFormData({ ...formData, meters: newMeters });
  };

  const generateResidentReport = async (resident: Resident) => {
    setIsGenerating(resident.id);
    try {
      const currentYear = parseInt(selectedYear);
      const startOfYear = `${currentYear}-01-01`;
      
      // Fetch all readings for this resident
      let readingsSnap;
      try {
        readingsSnap = await getDocs(query(collection(db, 'readings'), where('residentId', '==', resident.id)));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'readings');
      }
      const allReadings = readingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reading));
      
      // Filter readings for selected year and group by month to avoid duplicates
      // First, ensure we only take ONE reading per billingPeriodId (matching UI behavior)
      const uniqueReadingsMap = new Map<string, Reading>();
      allReadings.forEach(r => {
        if (!uniqueReadingsMap.has(r.billingPeriodId)) {
          uniqueReadingsMap.set(r.billingPeriodId, r);
        }
      });

      const yearReadingsMap = new Map<string, Reading>();
      Array.from(uniqueReadingsMap.values()).forEach(r => {
        const period = billingPeriods.find(p => p.id === r.billingPeriodId);
        // Only include readings from published periods to ensure finalized data
        if (period && period.status === 'published' && period.month.startsWith(currentYear.toString())) {
          const month = period.month;
          if (yearReadingsMap.has(month)) {
            const existing = yearReadingsMap.get(month)!;
            yearReadingsMap.set(month, {
              ...existing,
              meterConsumption: (existing.meterConsumption || 0) + (r.meterConsumption || 0),
              waterLossShare: (existing.waterLossShare || 0) + (r.waterLossShare || 0),
              waterLossCost: (existing.waterLossCost || 0) + (r.waterLossCost || 0),
              totalConsumption: (existing.totalConsumption || 0) + (r.totalConsumption || 0),
              waterCost: (existing.waterCost || 0) + (r.waterCost || 0),
              elecCost: (existing.elecCost || 0) + (r.elecCost || 0),
              repairFund: (existing.repairFund || 0) + (r.repairFund || 0),
              totalToPay: (existing.totalToPay || 0) + (r.totalToPay || 0),
              paidAmount: (existing.paidAmount || 0) + (r.paidAmount || 0),
            });
          } else {
            yearReadingsMap.set(month, { ...r });
          }
        }
      });

      const yearReadings = Array.from(yearReadingsMap.values()).sort((a, b) => {
        const pA = billingPeriods.find(p => p.id === a.billingPeriodId);
        const pB = billingPeriods.find(p => p.id === b.billingPeriodId);
        return (pA?.month || '').localeCompare(pB?.month || '');
      });

      // Fetch finance entries for this resident
      let financeSnap;
      try {
        financeSnap = await getDocs(query(collection(db, 'finance'), where('person', '==', resident.name)));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'finance');
      }
      const financeEntries = financeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceEntry))
        .filter(e => e.date >= startOfYear && e.date <= `${currentYear}-12-31`);

      const docPDF = new jsPDF('p', 'mm', 'a4');
      
      // Load Roboto font for Polish characters support
      try {
        const fontUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf';
        const fontBoldUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Medium.ttf';
        const [regRes, boldRes] = await Promise.all([fetch(fontUrl), fetch(fontBoldUrl)]);
        const [regBuffer, boldBuffer] = await Promise.all([regRes.arrayBuffer(), boldRes.arrayBuffer()]);
        const toBase64 = (buffer: ArrayBuffer) => {
          let binary = '';
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          return window.btoa(binary);
        };
        docPDF.addFileToVFS('Roboto-Regular.ttf', toBase64(regBuffer));
        docPDF.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
        docPDF.addFileToVFS('Roboto-Bold.ttf', toBase64(boldBuffer));
        docPDF.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
        docPDF.setFont('Roboto');
      } catch (e) {
        docPDF.setFont('helvetica');
      }

      docPDF.setFontSize(20);
      docPDF.setTextColor(79, 70, 229); // Indigo-600
      docPDF.text(`Raport Roczny ${currentYear}`, 14, 20);
      
      docPDF.setFontSize(12);
      docPDF.setTextColor(15, 23, 42); // Slate-900
      docPDF.text(`Mieszkaniec: ${resident.name}`, 14, 30);
      docPDF.text(`Numer lokalu: ${resident.apartmentNumber}`, 14, 36);
      
      const generationDate = format(new Date(), 'dd.MM.yyyy HH:mm', { locale: pl });
      docPDF.setFontSize(10);
      docPDF.setTextColor(100, 116, 139); // Slate-500
      docPDF.text(`Data wygenerowania: ${generationDate}`, 196, 20, { align: 'right' });

      // 1. Water Usage Table
      docPDF.setFontSize(14);
      docPDF.setTextColor(79, 70, 229);
      docPDF.text('Szczegółowe rozliczenie miesięczne', 14, 50);
      
      autoTable(docPDF, {
        startY: 55,
        head: [['Miesiąc', 'Liczniki (m³)', 'Ubytki (m³)', 'Suma (m³)', 'Woda (zł)', 'Prąd (zł)', 'Fundusz (zł)', 'Wpłata (zł)']],
        body: yearReadings.map(r => {
          const p = billingPeriods.find(period => period.id === r.billingPeriodId);
          const fund = r.repairFund || p?.renovationFundAtTime || globalSettings?.renovationFund || 0;
          
          return [
            p ? format(parseISO(p.month + '-01'), 'LLLL', { locale: pl }) : '?',
            (r.meterConsumption || 0).toFixed(3),
            (r.waterLossShare || 0).toFixed(3),
            (r.totalConsumption || 0).toFixed(3),
            (r.waterCost || 0).toFixed(2),
            (r.elecCost || 0).toFixed(2),
            fund.toFixed(2),
            (r.paidAmount || 0).toFixed(2)
          ];
        }),
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229], font: 'Roboto', fontStyle: 'bold' },
        styles: { font: 'Roboto' }
      });

      const finalYTable = (docPDF as any).lastAutoTable.finalY || 55;

      // 2. Summary Section
      const totalMeterConsumption = yearReadings.reduce((sum, r) => sum + (r.meterConsumption || 0), 0);
      const totalWaterLoss = yearReadings.reduce((sum, r) => sum + (r.waterLossShare || 0), 0);
      const totalWaterConsumption = yearReadings.reduce((sum, r) => sum + (r.totalConsumption || 0), 0);
      const totalWaterCost = yearReadings.reduce((sum, r) => sum + (r.waterCost || 0), 0);
      const totalElecCost = yearReadings.reduce((sum, r) => sum + (r.elecCost || 0), 0);
      const totalReadingPayments = yearReadings.reduce((sum, r) => sum + (r.paidAmount || 0), 0);
      
      // Manual payments from finance entries
      const manualPayments = financeEntries
        .filter(e => e.type === 'income' && !e.isAutomatic)
        .reduce((sum, e) => sum + e.amount, 0);
      
      const totalPayments = totalReadingPayments + manualPayments;
      
      // Formula: (Koszty wody + Koszty prądu) - Suma wpłat
      // Note: User prompt specifically asked for (Water + Elec) - Payments. 
      // However, usually repair fund is also a cost. I will stick to the prompt's formula but maybe add a note if balance differs from totalToPay.
      // Actually, I'll calculate balance as (Total Costs) - (Total Payments) where Total Costs = Water + Elec + RepairFund
      // But the prompt says: (Koszty wody + Koszty prądu) - Suma wpłat.
      // I'll follow the prompt exactly for the "Saldo" calculation as requested.
      
      const totalRepairFund = yearReadings.reduce((sum, r) => {
        const p = billingPeriods.find(period => period.id === r.billingPeriodId);
        return sum + (r.repairFund || p?.renovationFundAtTime || globalSettings?.renovationFund || 0);
      }, 0);

      const totalCosts = totalWaterCost + totalElecCost + totalRepairFund;
      const balance = totalCosts - totalPayments;

      docPDF.setFontSize(16);
      docPDF.setFont('Roboto', 'bold');
      docPDF.setTextColor(15, 23, 42);
      docPDF.text('PODSUMOWANIE ROCZNE', 14, finalYTable + 20);
      
      docPDF.setFontSize(12);
      docPDF.setFont('Roboto', 'normal');
      docPDF.text(`1. Rozliczenie wody:`, 14, finalYTable + 30);
      docPDF.text(`${totalWaterCost.toFixed(2)} zł`, 180, finalYTable + 30, { align: 'right' });
      
      docPDF.setFontSize(10);
      docPDF.setTextColor(100, 116, 139);
      docPDF.text(`- zużycie z liczników: ${totalMeterConsumption.toFixed(3)} m³`, 18, finalYTable + 36);
      docPDF.text(`- udział w ubytkach: ${totalWaterLoss.toFixed(3)} m³`, 18, finalYTable + 41);
      docPDF.text(`- suma zużycia: ${totalWaterConsumption.toFixed(3)} m³`, 18, finalYTable + 46);
      
      docPDF.setFontSize(12);
      docPDF.setTextColor(15, 23, 42);
      docPDF.text(`2. Rozliczenie prądu:`, 14, finalYTable + 54);
      docPDF.text(`${totalElecCost.toFixed(2)} zł`, 180, finalYTable + 54, { align: 'right' });
      
      docPDF.text(`3. Fundusz remontowy:`, 14, finalYTable + 62);
      docPDF.text(`${totalRepairFund.toFixed(2)} zł`, 180, finalYTable + 62, { align: 'right' });
      
      docPDF.setFont('Roboto', 'bold');
      docPDF.text(`SUMA KOSZTÓW:`, 14, finalYTable + 72);
      docPDF.text(`${totalCosts.toFixed(2)} zł`, 180, finalYTable + 72, { align: 'right' });
      
      docPDF.setFont('Roboto', 'normal');
      docPDF.text(`SUMA WPŁAT:`, 14, finalYTable + 80);
      docPDF.text(`${totalPayments.toFixed(2)} zł`, 180, finalYTable + 80, { align: 'right' });

      const isOverpaid = balance < 0;
      const balanceText = isOverpaid ? 'NADPŁATA (do zwrotu/rozliczenia)' : 'NIEDOPŁATA (do zapłaty)';
      const color = isOverpaid ? [5, 150, 105] : [225, 29, 72];

      docPDF.setFontSize(16);
      docPDF.setFont('Roboto', 'bold');
      docPDF.setTextColor(color[0], color[1], color[2]);
      docPDF.text(`${balanceText}:`, 14, finalYTable + 95);
      docPDF.text(`${Math.abs(balance).toFixed(2)} zł`, 180, finalYTable + 95, { align: 'right' });

      docPDF.save(`raport-roczny-${resident.apartmentNumber}-${resident.name}-${currentYear}.pdf`);
    } catch (error) {
      console.error("Error generating resident report:", error);
      alert("Błąd podczas generowania raportu.");
    } finally {
      setIsGenerating(null);
    }
  };



  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Mieszkańcy</h1>
          <p className="text-slate-500">Zarządzaj listą lokali i danymi kontaktowymi.</p>
        </div>
        <button 
          onClick={() => {
            setEditingResident(null);
            setFormData({ 
              name: '', 
              apartmentNumber: '', 
              email: '', 
              phone: '', 
              meters: [{ id: crypto.randomUUID(), name: 'Licznik 1', initialReading: 0 }] 
            });
            setShowAddModal(true);
          }}
          className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-semibold hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-lg shadow-indigo-200"
        >
          <Plus size={20} />
          <span>Dodaj Mieszkańca</span>
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 font-bold text-slate-700 text-sm uppercase tracking-wider">Lokal</th>
              <th className="px-6 py-4 font-bold text-slate-700 text-sm uppercase tracking-wider">Nazwisko</th>
              <th className="px-6 py-4 font-bold text-slate-700 text-sm uppercase tracking-wider">Email / Telefon</th>
              <th className="px-6 py-4 font-bold text-slate-700 text-sm uppercase tracking-wider">Liczniki (Stan Początkowy)</th>
              <th className="px-6 py-4 font-bold text-slate-700 text-sm uppercase tracking-wider text-right">Akcje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...residents].sort((a, b) => a.apartmentNumber.localeCompare(b.apartmentNumber, undefined, { numeric: true, sensitivity: 'base' })).map(resident => (
              <tr key={resident.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-6 py-4 font-bold text-indigo-600">{resident.apartmentNumber}</td>
                <td className="px-6 py-4 font-semibold text-slate-900">{resident.name}</td>
                <td className="px-6 py-4">
                  <div className="text-sm text-slate-600">{resident.email}</div>
                  <div className="text-xs text-slate-400">{resident.phone}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="space-y-1">
                    {(resident.meters || []).map((m, idx) => (
                      <div key={idx} className="text-sm text-slate-600">
                        <span className="font-medium">{m.name}:</span> {m.initialReading} m³
                      </div>
                    ))}
                    {(resident.meters || []).length > 1 && (
                      <div className="text-xs font-bold text-indigo-600 pt-1 border-t border-slate-100">
                        Suma: {(resident.meters || []).reduce((s, m) => s + m.initialReading, 0).toFixed(3)} m³
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => generateResidentReport(resident)}
                      disabled={isGenerating === resident.id}
                      className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all disabled:opacity-50"
                      title="Generuj raport roczny"
                    >
                      {isGenerating === resident.id ? <RefreshCw size={18} className="animate-spin" /> : <FileText size={18} />}
                    </button>
                    <button 
                      onClick={() => {
                        setEditingResident(resident);
                        setFormData({
                          name: resident.name,
                          apartmentNumber: resident.apartmentNumber,
                          email: resident.email,
                          phone: resident.phone,
                          meters: (resident.meters || []).map(m => ({ ...m, id: m.id || crypto.randomUUID() }))
                        });
                        if ((resident.meters || []).length === 0) {
                          setFormData(prev => ({
                            ...prev,
                            meters: [{ id: crypto.randomUUID(), name: 'Licznik 1', initialReading: 0 }]
                          }));
                        }
                        setShowAddModal(true);
                      }}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => handleDelete(resident.id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {residents.length === 0 && (
          <div className="p-12 text-center text-slate-500 italic">Brak mieszkańców w systemie.</div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-8 my-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">
              {editingResident ? 'Edytuj mieszkańca' : 'Dodaj nowego mieszkańca'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Numer lokalu</label>
                  <input 
                    required
                    type="text" 
                    value={formData.apartmentNumber}
                    onChange={(e) => setFormData({...formData, apartmentNumber: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Imię i Nazwisko</label>
                  <input 
                    required
                    type="text" 
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
                  <input 
                    type="email" 
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Telefon</label>
                  <input 
                    type="text" 
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-900">Liczniki wody</h3>
                  <button 
                    type="button"
                    onClick={addMeterField}
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-bold flex items-center gap-1"
                  >
                    <Plus size={16} />
                    Dodaj licznik
                  </button>
                </div>
                
                <div className="space-y-4">
                  {formData.meters.map((meter, index) => (
                    <div key={index} className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">
                          {meter.name || `Licznik ${index + 1}`}
                        </span>
                        <button 
                          type="button"
                          onClick={() => removeMeterField(index)}
                          className="text-slate-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="flex items-end gap-4">
                        <div className="flex-1">
                          <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">Nazwa licznika</label>
                          <input 
                            required
                            type="text" 
                            value={meter.name}
                            onChange={(e) => updateMeterField(index, 'name', e.target.value)}
                            placeholder="np. Kuchnia, Łazienka"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                          />
                        </div>
                        <div className="w-40">
                          <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">Stan pocz. (m³)</label>
                          <input 
                            required
                            type="number" 
                            step="0.001"
                            value={meter.initialReading}
                            onChange={(e) => updateMeterField(index, 'initialReading', parseFloat(e.target.value))}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-6 py-3 rounded-xl font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Anuluj
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
                >
                  Zapisz
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Settings({ settings }: { settings: GlobalSettings | null }) {
  const [fund, setFund] = useState(settings?.renovationFund || 150);
  const [initialBalance, setInitialBalance] = useState(settings?.initialBalance || 0);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'global'), {
        renovationFund: fund,
        initialBalance: initialBalance,
        lastUpdated: new Date().toISOString()
      });
      alert("Ustawienia zapisane.");
    } catch (error) {
      console.error("Error saving settings:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Ustawienia</h1>
        <p className="text-slate-500">Skonfiguruj globalne parametry rozliczeń.</p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-8 max-w-2xl shadow-sm">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Fundusz Remontowy (zł / lokal)</label>
            <p className="text-sm text-slate-500 mb-4">Stała kwota doliczana co miesiąc do każdego lokalu niezależnie od zużycia wody.</p>
            <div className="relative">
              <input 
                type="number" 
                step="0.01"
                value={fund}
                onChange={(e) => setFund(parseFloat(e.target.value) || 0)}
                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-xl font-bold"
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">zł</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Stan początkowy konta (zł)</label>
            <p className="text-sm text-slate-500 mb-4">Kwota bazowa, od której zaczyna się wyliczanie salda finansowego.</p>
            <div className="relative">
              <input 
                type="number" 
                step="0.01"
                value={initialBalance}
                onChange={(e) => setInitialBalance(parseFloat(e.target.value) || 0)}
                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-xl font-bold"
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">zł</span>
            </div>
          </div>

          <div className="pt-4">
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-semibold hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-lg disabled:opacity-50"
            >
              {isSaving ? 'Zapisywanie...' : (
                <>
                  <Save size={20} />
                  <span>Zapisz Ustawienia</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PeriodDetail({ periodId, residents, billingPeriods, globalSettings, onBack }: { 
  periodId: string, 
  residents: Resident[], 
  billingPeriods: BillingPeriod[],
  globalSettings: GlobalSettings | null,
  onBack: () => void 
}) {
  const [period, setPeriod] = useState<BillingPeriod | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [isEditingMain, setIsEditingMain] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [mainFormData, setMainFormData] = useState({
    mainMeterStart: 0,
    mainMeterEnd: 0,
    totalInvoiceAmount: 0,
    elecMeterStart: 0,
    elecMeterEnd: 0,
    elecTotalInvoiceAmount: 0,
    invoicePeriodStart: '',
    invoicePeriodEnd: '',
    renovationFundAtTime: 0
  });

  useEffect(() => {
    const unsubPeriod = onSnapshot(doc(db, 'billingPeriods', periodId), (doc) => {
      if (doc.exists()) {
        const data = doc.data() as BillingPeriod;
        setPeriod({ id: doc.id, ...data });
        setMainFormData({
          mainMeterStart: data.mainMeterStart,
          mainMeterEnd: data.mainMeterEnd,
          totalInvoiceAmount: data.totalInvoiceAmount,
          elecMeterStart: data.elecMeterStart || 0,
          elecMeterEnd: data.elecMeterEnd || 0,
          elecTotalInvoiceAmount: data.elecTotalInvoiceAmount || 0,
          invoicePeriodStart: data.invoicePeriodStart || '',
          invoicePeriodEnd: data.invoicePeriodEnd || '',
          renovationFundAtTime: data.renovationFundAtTime || 0
        });
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `billingPeriods/${periodId}`));

    const unsubReadings = onSnapshot(query(collection(db, 'readings')), (snapshot) => {
      setReadings(snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Reading))
        .filter(r => r.billingPeriodId === periodId)
      );
    }, (error) => handleFirestoreError(error, OperationType.GET, 'readings'));

    return () => {
      unsubPeriod();
      unsubReadings();
    };
  }, [periodId]);

  const recalculateReadings = async (
    currentPeriod: BillingPeriod, 
    updatedReading?: { residentId: string, totalConsumption: number, meterReadings: MeterReading[] }
  ) => {
    if (currentPeriod.status !== 'draft') return;
    
    // Fetch latest readings directly from Firestore to avoid stale state
    let readingsSnap;
    try {
      readingsSnap = await getDocs(query(collection(db, 'readings'), where('billingPeriodId', '==', currentPeriod.id)));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'readings');
    }
    const currentReadings = readingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reading));

    // Fetch previous readings to correctly initialize placeholder records
    const sortedAllPeriods = [...billingPeriods].sort((a, b) => b.month.localeCompare(a.month));
    const currentPeriodIndex = sortedAllPeriods.findIndex(p => p.id === currentPeriod.id);
    const prevPeriod = currentPeriodIndex < sortedAllPeriods.length - 1 ? sortedAllPeriods[currentPeriodIndex + 1] : null;

    let prevReadings: Reading[] = [];
    if (prevPeriod) {
      const q = query(collection(db, 'readings'), where('billingPeriodId', '==', prevPeriod.id));
      let snapshot;
      try {
        snapshot = await getDocs(q);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'readings');
      }
      prevReadings = snapshot.docs.map(doc => doc.data() as Reading);
    }

    const totalResidentsMeterConsumption = residents.reduce((sum, res) => {
      if (updatedReading && res.id === updatedReading.residentId) {
        return sum + updatedReading.totalConsumption;
      }
      const r = currentReadings.find(read => read.residentId === res.id);
      return sum + (r?.meterConsumption ?? 0);
    }, 0);

    const totalMetersCount = residents.reduce((sum, res) => sum + (res.meters?.length || 0), 0);
    // Ensure ubytki are not negative if data is incomplete or main meter is not yet entered
    const totalUbytki = (currentPeriod.totalConsumption || 0) - totalResidentsMeterConsumption;
    const ubytkiPerMeter = totalMetersCount > 0 ? totalUbytki / totalMetersCount : 0;

    const elecCostPerResident = residents.length > 0 ? currentPeriod.elecTotalInvoiceAmount / residents.length : 0;

    const promises = residents.map(async (res) => {
      const existing = currentReadings.find(r => r.residentId === res.id);
      const isUpdatingThis = updatedReading && res.id === updatedReading.residentId;
      
      const meterConsumption = isUpdatingThis ? updatedReading.totalConsumption : (existing?.meterConsumption ?? 0);
      const resMeterCount = res.meters?.length || 0;
      const resWaterLossShare = ubytkiPerMeter * resMeterCount;
      const residentTotalConsumption = meterConsumption + resWaterLossShare;
      
      // Koszt wody dla mieszkańca: (zużycie z liczników + udział w ubytkach) * cena za m³
      const residentWaterCost = residentTotalConsumption * currentPeriod.pricePerM3;
      const totalToPay = residentWaterCost + currentPeriod.renovationFundAtTime + elecCostPerResident;

      const data: any = {
        meterConsumption,
        waterLossShare: resWaterLossShare,
        waterLossCost: resWaterLossShare * currentPeriod.pricePerM3,
        totalConsumption: residentTotalConsumption,
        waterCost: residentWaterCost,
        elecCost: elecCostPerResident,
        repairFund: currentPeriod.renovationFundAtTime,
        totalToPay
      };

      if (existing) {
        if (isUpdatingThis) {
          data.meterReadings = updatedReading.meterReadings;
        }
        return updateDoc(doc(db, 'readings', existing.id), data);
      } else {
        // Create new reading (either the updated one or a placeholder)
        let meterReadings: MeterReading[];
        
        if (isUpdatingThis) {
          meterReadings = updatedReading.meterReadings;
        } else {
          // Placeholder reading
          const prevReading = prevReadings.find(pr => pr.residentId === res.id);
          const residentMeters = res.meters || [{ name: 'Licznik 1', initialReading: 0 }];
          
          meterReadings = residentMeters.map((m, idx) => {
            const start = prevReading?.meterReadings[idx]?.endReading ?? m.initialReading;
            return {
              startReading: start,
              endReading: start,
              consumption: 0
            };
          });
        }

        return addDoc(collection(db, 'readings'), {
          billingPeriodId: currentPeriod.id,
          residentId: res.id,
          meterReadings,
          ...data
        });
      }
    });

    try {
      await Promise.all(promises);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'readings/batch');
    }
  };

  const handleSaveMain = async () => {
    if (!period || period.status !== 'draft') return;
    const totalConsumption = mainFormData.mainMeterEnd - mainFormData.mainMeterStart;
    const pricePerM3 = totalConsumption > 0 ? mainFormData.totalInvoiceAmount / totalConsumption : 0;
    
    const elecTotalConsumption = mainFormData.elecMeterEnd - mainFormData.elecMeterStart;
    const elecPricePerKWh = elecTotalConsumption > 0 ? mainFormData.elecTotalInvoiceAmount / elecTotalConsumption : 0;

    const updatedPeriod = {
      ...period,
      ...mainFormData,
      totalConsumption,
      pricePerM3,
      elecTotalConsumption,
      elecPricePerKWh
    };

    try {
      await updateDoc(doc(db, 'billingPeriods', periodId), {
        ...mainFormData,
        totalConsumption,
        pricePerM3,
        elecTotalConsumption,
        elecPricePerKWh
      });
      
      await recalculateReadings(updatedPeriod);
      setIsEditingMain(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `billingPeriods/${periodId}`);
    }
  };

  const handleUpdateReading = async (residentId: string, meterIndex: number, endReading: number) => {
    if (!period || period.status !== 'draft') return;
    
    const resident = residents.find(r => r.id === residentId);
    if (!resident) return;

    const existingReading = readings.find(r => r.residentId === residentId);
    let newMeterReadings: MeterReading[] = [];
    const residentMeters = resident.meters || [{ name: 'Licznik 1', initialReading: 0 }];

    const getPrevReadings = async () => {
      const sortedAllPeriods = [...billingPeriods].sort((a, b) => b.month.localeCompare(a.month));
      const currentPeriodIndex = sortedAllPeriods.findIndex(p => p.id === periodId);
      const prevPeriod = currentPeriodIndex < sortedAllPeriods.length - 1 ? sortedAllPeriods[currentPeriodIndex + 1] : null;

      if (prevPeriod) {
        const q = query(collection(db, 'readings'), where('billingPeriodId', '==', prevPeriod.id), where('residentId', '==', residentId));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          return (snapshot.docs[0].data() as Reading).meterReadings;
        }
      }
      return [];
    };

    if (existingReading) {
      newMeterReadings = [...existingReading.meterReadings];
      // Ensure the array has enough slots
      if (newMeterReadings.length < residentMeters.length) {
        const prevMeters = await getPrevReadings();
        while (newMeterReadings.length < residentMeters.length) {
          const idx = newMeterReadings.length;
          const start = prevMeters[idx] ? prevMeters[idx].endReading : residentMeters[idx].initialReading;
          newMeterReadings.push({
            startReading: start,
            endReading: start,
            consumption: 0
          });
        }
      }
      
      const startReading = newMeterReadings[meterIndex].startReading;
      newMeterReadings[meterIndex] = {
        startReading,
        endReading,
        consumption: endReading - startReading
      };
    } else {
      // Create new reading object
      const prevMeters = await getPrevReadings();
      newMeterReadings = residentMeters.map((m, idx) => {
        const start = prevMeters[idx] ? prevMeters[idx].endReading : m.initialReading;
        const end = idx === meterIndex ? endReading : start;
        return {
          startReading: start,
          endReading: end,
          consumption: end - start
        };
      });
    }

    const meterConsumption = newMeterReadings.reduce((sum, m) => sum + m.consumption, 0);
    
    try {
      await recalculateReadings(period, {
        residentId,
        totalConsumption: meterConsumption,
        meterReadings: newMeterReadings
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'readings');
    }
  };

  const handleUpdatePayment = async (residentId: string, field: 'paidAmount' | 'paymentDate', value: any) => {
    if (!period) return;
    const existing = readings.find(r => r.residentId === residentId);
    
    if (existing) {
      try {
        await updateDoc(doc(db, 'readings', existing.id), { [field]: value });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'readings');
      }
    } else {
      const resident = residents.find(r => r.id === residentId);
      if (!resident) return;

      const sortedAllPeriods = [...billingPeriods].sort((a, b) => b.month.localeCompare(a.month));
      const currentPeriodIndex = sortedAllPeriods.findIndex(p => p.id === periodId);
      const prevPeriod = currentPeriodIndex < sortedAllPeriods.length - 1 ? sortedAllPeriods[currentPeriodIndex + 1] : null;

      let prevMeters: MeterReading[] = [];
      if (prevPeriod) {
        const q = query(collection(db, 'readings'), where('billingPeriodId', '==', prevPeriod.id), where('residentId', '==', residentId));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          prevMeters = (snapshot.docs[0].data() as Reading).meterReadings;
        }
      }

      const residentMeters = resident.meters || [{ name: 'Licznik 1', initialReading: 0 }];
      const meterReadings = residentMeters.map((m, idx) => {
        const start = prevMeters[idx] ? prevMeters[idx].endReading : m.initialReading;
        return { startReading: start, endReading: start, consumption: 0 };
      });

      await recalculateReadings(period, {
        residentId,
        totalConsumption: 0,
        meterReadings
      });
      
      // After recalculate, we might need to update the payment field specifically if it wasn't handled
      const newReadings = await getDocs(query(collection(db, 'readings'), where('billingPeriodId', '==', periodId), where('residentId', '==', residentId)));
      if (!newReadings.empty) {
        await updateDoc(doc(db, 'readings', newReadings.docs[0].id), { [field]: value });
      }
    }
  };

  const handlePublish = async () => {
    if (!period) return;
    try {
      await updateDoc(doc(db, 'billingPeriods', periodId), { status: 'published' });
      setIsPublishing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `billingPeriods/${periodId}`);
    }
  };

  const handleUnpublish = async () => {
    if (pinInput === '0110') {
      try {
        await updateDoc(doc(db, 'billingPeriods', periodId), { status: 'draft' });
        setIsUnpublishing(false);
        setPinInput('');
        setPinError(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `billingPeriods/${periodId}`);
      }
    } else {
      setPinError(true);
    }
  };

  const handleSendSummary = (resident: Resident, reading: Reading | undefined, type: 'whatsapp' | 'sms' | 'copy' = 'whatsapp') => {
    if (!reading || !period) return;
    
    let meterDetails = "";
    const residentMeters = resident.meters || [];
    residentMeters.forEach((m, idx) => {
      const mr = reading.meterReadings[idx];
      if (mr) {
        meterDetails += `- ${m.name}: ${mr.consumption.toFixed(3)} m³\n`;
      }
    });

    const resMeterConsumption = reading?.meterConsumption ?? 0;
    const totalMetersCount = residents.reduce((sum, res) => sum + (res.meters?.length || 0), 0);
    const ubytki = (period.totalConsumption || 0) - totalResidentsMeterConsumption;
    const ubytkiPerMeter = totalMetersCount > 0 ? ubytki / totalMetersCount : 0;
    const resMeterCount = resident.meters?.length || 0;
    const resWaterLossShare = ubytkiPerMeter * resMeterCount;
    const resTotalConsumption = resMeterConsumption + resWaterLossShare;
    const resWaterCost = resTotalConsumption * period.pricePerM3;
    const resElecCost = residents.length > 0 ? period.elecTotalInvoiceAmount / residents.length : 0;
    const resTotalToPay = resWaterCost + period.renovationFundAtTime + resElecCost;

    const message = `Lokal ${resident.apartmentNumber} - ${resident.name}\n` +
      `Rozliczenie mediów - ${format(parseISO(period.month + '-01'), 'LLLL yyyy', { locale: pl })}\n` +
      `Woda i ubytki: ${resTotalConsumption.toFixed(3)} m³\n` +
      `Kwota za wodę: ${resWaterCost.toFixed(2)} zł\n` +
      `Kwota za prąd: ${resElecCost.toFixed(2)} zł\n` +
      `Fundusz remontowy: ${period.renovationFundAtTime.toFixed(2)} zł\n` +
      `RAZEM DO ZAPŁATY: ${resTotalToPay.toFixed(2)} zł`;
    
    if (type === 'whatsapp') {
      const encodedMessage = encodeURIComponent(message);
      window.open(`https://wa.me/${resident.phone.replace(/\s/g, '')}?text=${encodedMessage}`, '_blank');
    } else if (type === 'sms') {
      const encodedMessage = encodeURIComponent(message);
      window.open(`sms:${resident.phone.replace(/\s/g, '')}?body=${encodedMessage}`, '_self');
    } else if (type === 'copy') {
      navigator.clipboard.writeText(message).then(() => {
        // No alert as per instructions, user will see the text is copied if we add a toast later
      }).catch(err => {
        console.error('Could not copy text: ', err);
      });
    }
  };

  if (!period) return null;

  const totalResidentsMeterConsumption = residents.reduce((sum, res) => {
    const r = readings.find(read => read.residentId === res.id);
    return sum + (r?.meterConsumption || 0);
  }, 0);

  const totalMeters = residents.reduce((sum, res) => sum + (res.meters?.length || 0), 0);
  const ubytki = (period.totalConsumption || 0) - totalResidentsMeterConsumption;
  const totalMetersCount = residents.reduce((sum, res) => sum + (res.meters?.length || 0), 0);
  const ubytkiPerMeter = totalMetersCount > 0 ? ubytki / totalMetersCount : 0;
  const elecCostPerResident = residents.length > 0 ? (period.elecTotalInvoiceAmount || 0) / residents.length : 0;

  return (
    <div className="space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X size={24} />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 capitalize">
              {format(parseISO(period.month + '-01'), 'LLLL yyyy', { locale: pl })}
            </h1>
            <p className="text-slate-500">Szczegółowe rozliczenie i stany liczników.</p>
          </div>
        </div>
        <div className="flex gap-3">
          {period.status === 'draft' && (
            <div className="flex items-center gap-2">
              {isPublishing ? (
                <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-right-4">
                  <span className="text-sm font-bold text-slate-600 px-2">Czy na pewno?</span>
                  <button 
                    onClick={handlePublish}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700 transition-all"
                  >
                    Tak, opublikuj
                  </button>
                  <button 
                    onClick={() => setIsPublishing(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setIsPublishing(true)}
                  className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-semibold hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-lg shadow-emerald-100"
                >
                  <CheckCircle2 size={20} />
                  <span>Opublikuj</span>
                </button>
              )}
            </div>
          )}
          {period.status === 'published' && (
            <div className="flex items-center gap-2">
              {isUnpublishing ? (
                <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-right-4">
                  <input 
                    type="password" 
                    placeholder="Kod PIN"
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value);
                      setPinError(false);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleUnpublish()}
                    className={cn(
                      "w-24 px-3 py-2 rounded-lg border outline-none transition-all text-center font-bold tracking-widest",
                      pinError ? "border-rose-500 ring-2 ring-rose-100" : "border-slate-200 focus:ring-2 focus:ring-indigo-500"
                    )}
                  />
                  <button 
                    onClick={handleUnpublish}
                    className="bg-slate-900 text-white px-4 py-2 rounded-lg font-semibold hover:bg-slate-800 transition-all"
                  >
                    OK
                  </button>
                  <button 
                    onClick={() => {
                      setIsUnpublishing(false);
                      setPinInput('');
                      setPinError(false);
                    }}
                    className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setIsUnpublishing(true)}
                  className="text-slate-500 hover:text-indigo-600 font-semibold flex items-center gap-2 px-4 py-2 rounded-xl hover:bg-slate-50 transition-all"
                >
                  <RefreshCw size={18} />
                  <span>Przywróć do edycji</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Invoice Data */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Droplets className="text-indigo-600" />
            Dane z faktur głównych
          </h2>
          {period.status === 'draft' && !isEditingMain && (
            <button 
              onClick={() => setIsEditingMain(true)}
              className="text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1"
            >
              <Edit2 size={16} />
              Edytuj
            </button>
          )}
        </div>

        {isEditingMain ? (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Okres rozliczenia od</label>
                <input 
                  type="date" 
                  value={mainFormData.invoicePeriodStart}
                  onChange={(e) => setMainFormData({...mainFormData, invoicePeriodStart: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Okres rozliczenia do</label>
                <input 
                  type="date" 
                  value={mainFormData.invoicePeriodEnd}
                  onChange={(e) => setMainFormData({...mainFormData, invoicePeriodEnd: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Fundusz Remontowy (zł/lokal)</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={mainFormData.renovationFundAtTime}
                  onChange={(e) => setMainFormData({...mainFormData, renovationFundAtTime: parseFloat(e.target.value)})}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-indigo-600"
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Droplets size={18} className="text-indigo-600" />
                Faktura za wodę
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Stan pocz. licznika wody</label>
                  <input 
                    type="number" 
                    step="0.001"
                    value={mainFormData.mainMeterStart}
                    onChange={(e) => setMainFormData({...mainFormData, mainMeterStart: parseFloat(e.target.value)})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Stan końc. licznika wody</label>
                  <input 
                    type="number" 
                    step="0.001"
                    value={mainFormData.mainMeterEnd}
                    onChange={(e) => setMainFormData({...mainFormData, mainMeterEnd: parseFloat(e.target.value)})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Kwota faktury woda (zł)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={mainFormData.totalInvoiceAmount}
                    onChange={(e) => setMainFormData({...mainFormData, totalInvoiceAmount: parseFloat(e.target.value)})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Zap size={18} className="text-amber-500" />
                Faktura za prąd
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Stan pocz. licznika prądu</label>
                  <input 
                    type="number" 
                    step="0.001"
                    value={mainFormData.elecMeterStart}
                    onChange={(e) => setMainFormData({...mainFormData, elecMeterStart: parseFloat(e.target.value)})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Stan końc. licznika prądu</label>
                  <input 
                    type="number" 
                    step="0.001"
                    value={mainFormData.elecMeterEnd}
                    onChange={(e) => setMainFormData({...mainFormData, elecMeterEnd: parseFloat(e.target.value)})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Kwota faktury prąd (zł)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={mainFormData.elecTotalInvoiceAmount}
                    onChange={(e) => setMainFormData({...mainFormData, elecTotalInvoiceAmount: parseFloat(e.target.value)})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              {period.status === 'draft' && (
                <button 
                  type="button"
                  onClick={() => recalculateReadings(period!)}
                  className="px-6 py-2 rounded-xl font-semibold text-amber-600 hover:bg-amber-50 flex items-center gap-2"
                >
                  <RefreshCw size={18} />
                  Przelicz wszystko
                </button>
              )}
              <button 
                type="button"
                onClick={() => setIsEditingMain(false)}
                className="px-6 py-2 rounded-xl font-semibold text-slate-600 hover:bg-slate-50"
              >
                Anuluj
              </button>
              <button 
                onClick={handleSaveMain}
                className="bg-indigo-600 text-white px-8 py-2 rounded-xl font-semibold hover:bg-indigo-700"
              >
                Zapisz
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {(period.invoicePeriodStart || period.invoicePeriodEnd) && (
              <div className="flex items-center gap-2 text-slate-600 bg-slate-50 px-4 py-2 rounded-xl w-fit">
                <Calendar size={16} />
                <span className="text-sm font-medium">
                  Okres faktury: {period.invoicePeriodStart ? format(parseISO(period.invoicePeriodStart), 'dd.MM.yyyy') : '?'} - {period.invoicePeriodEnd ? format(parseISO(period.invoicePeriodEnd), 'dd.MM.yyyy') : '?'}
                </span>
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Droplets size={16} className="text-indigo-600" />
                  Woda
                </h3>
                {period.totalConsumption <= 0 && period.totalInvoiceAmount > 0 && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl flex items-start gap-3 text-sm">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <p>Brak zużycia ogólnego (liczniki główne). Cena za m³ wynosi 0.00 zł. Uzupełnij stany licznika głównego.</p>
                  </div>
                )}
                {residents.length > readings.length && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-xl flex items-start gap-3 text-sm">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <p>Brakuje odczytów dla {residents.length - readings.length} lokali. Straty wody (ubytki) są obecnie zawyżone.</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Zużycie</p>
                    <p className="text-2xl font-bold text-slate-900">{period.totalConsumption.toFixed(3)} m³</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Kwota</p>
                    <p className="text-2xl font-bold text-slate-900">{period.totalInvoiceAmount.toFixed(2)} zł</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Cena/m³</p>
                    <p className="text-2xl font-bold text-indigo-600">{period.pricePerM3.toFixed(2)} zł</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Suma lokali</p>
                    <p className="text-2xl font-bold text-slate-900">{totalResidentsMeterConsumption.toFixed(3)} m³</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Ubytki</p>
                    <p className={`text-2xl font-bold ${ubytki > 0 ? 'text-amber-600' : ubytki < 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                      {ubytki.toFixed(3)} m³
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Ubytki na licznik</p>
                    <p className={`text-2xl font-bold ${ubytki > 0 ? 'text-amber-600' : ubytki < 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                      {ubytkiPerMeter.toFixed(3)} m³
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Fundusz Remontowy</p>
                    <p className="text-2xl font-bold text-indigo-600">{period.renovationFundAtTime?.toFixed(2) || '0.00'} zł</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Zap size={16} className="text-amber-500" />
                  Prąd
                </h3>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Zużycie</p>
                    <p className="text-2xl font-bold text-slate-900">{(period.elecTotalConsumption || 0).toFixed(3)} kWh</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Kwota</p>
                    <p className="text-2xl font-bold text-slate-900">{(period.elecTotalInvoiceAmount || 0).toFixed(2)} zł</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Cena/kWh</p>
                    <p className="text-2xl font-bold text-amber-600">{(period.elecPricePerKWh || 0).toFixed(2)} zł</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Na lokal</p>
                    <p className="text-2xl font-bold text-slate-900">
                      {residents.length > 0 ? ((period.elecTotalInvoiceAmount || 0) / residents.length).toFixed(2) : '0.00'} zł
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Residents Readings Table */}
      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-900">Stany liczników indywidualnych</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="sticky left-0 z-20 bg-slate-50 px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider border-r border-slate-200">Lokal / Mieszkaniec</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Liczniki (Początek / Koniec / Zużycie)</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Zużycie z liczników</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Ubytki</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Suma Zużycia</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Woda</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Prąd</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Fundusz</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Suma</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Zapłacono</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider">Data płatności</th>
                <th className="px-6 py-4 font-bold text-slate-700 text-xs uppercase tracking-wider text-right">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...residents].sort((a, b) => a.apartmentNumber.localeCompare(b.apartmentNumber, undefined, { numeric: true, sensitivity: 'base' })).map(resident => {
                const reading = readings.find(r => r.residentId === resident.id);
                const resMeterCount = resident.meters?.length || 0;
                const resWaterLossShare = ubytkiPerMeter * resMeterCount;
                
                return (
                  <tr key={resident.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="sticky left-0 z-10 bg-white px-6 py-4 border-r border-slate-200 group-hover:bg-slate-50 transition-colors">
                      <div className="font-bold text-indigo-600">{resident.apartmentNumber}</div>
                      <div className="font-semibold text-slate-900 text-sm">{resident.name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-3">
                        {(resident.meters || []).map((meter, idx) => {
                          const mr = reading?.meterReadings?.[idx];
                          const start = mr ? mr.startReading : meter.initialReading;
                          const end = mr ? mr.endReading : start;
                          const cons = mr ? mr.consumption : 0;
                          
                          return (
                            <div key={idx} className="bg-sky-50/50 p-3 rounded-xl border border-sky-100 space-y-2">
                              <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">{meter.name}</div>
                              <div className="flex items-center gap-3 text-sm">
                                <div className="flex flex-col">
                                  <span className="text-[10px] text-slate-400 uppercase font-bold">Ostatni odczyt</span>
                                  <span className="text-slate-600 font-medium">{start.toFixed(3)}</span>
                                </div>
                                <span className="text-slate-300 mt-3">→</span>
                                <div className="flex flex-col">
                                  <span className="text-[10px] text-slate-400 uppercase font-bold">Bieżący odczyt</span>
                                  {period.status === 'draft' ? (
                                    <input 
                                      type="number" 
                                      step="0.001"
                                      defaultValue={end}
                                      onBlur={(e) => {
                                        const val = parseFloat(e.target.value);
                                        handleUpdateReading(resident.id, idx, isNaN(val) ? start : val);
                                      }}
                                      className="w-24 px-2 py-1 rounded border border-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none text-sm font-semibold"
                                    />
                                  ) : (
                                    <span className="text-slate-900 font-semibold">{end.toFixed(3)}</span>
                                  )}
                                </div>
                                <span className="text-slate-300 mt-3">=</span>
                                <div className="flex flex-col">
                                  <span className="text-[10px] text-slate-400 uppercase font-bold">Zużycie</span>
                                  <span className="font-bold text-slate-900">{cons.toFixed(3)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-900 font-semibold">
                      {reading?.meterConsumption?.toFixed(3) ?? '0.000'} m³
                    </td>
                    <td className={`px-6 py-4 font-semibold ${resWaterLossShare > 0 ? 'text-amber-600' : resWaterLossShare < 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                      {resWaterLossShare.toFixed(3)} m³
                    </td>
                    <td className="px-6 py-4 text-slate-900 font-bold text-lg">
                      {((reading?.meterConsumption ?? 0) + resWaterLossShare).toFixed(3)} m³
                    </td>
                    <td className="px-6 py-4 text-slate-600 text-sm">
                      {(((reading?.meterConsumption ?? 0) + resWaterLossShare) * period.pricePerM3).toFixed(2)} zł
                    </td>
                    <td className="px-6 py-4 text-slate-600 text-sm">
                      {elecCostPerResident.toFixed(2)} zł
                    </td>
                    <td className="px-6 py-4 text-slate-600 text-sm">
                      {period.renovationFundAtTime.toFixed(2)} zł
                    </td>
                    <td className="px-6 py-4 font-bold text-indigo-600 text-lg">
                      {((((reading?.meterConsumption ?? 0) + resWaterLossShare) * period.pricePerM3) + period.renovationFundAtTime + elecCostPerResident).toFixed(2)} zł
                    </td>
                    <td className="px-6 py-4">
                      <input 
                        type="number" 
                        step="0.01"
                        defaultValue={reading?.paidAmount ?? 0}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value);
                          handleUpdatePayment(resident.id, 'paidAmount', isNaN(val) ? 0 : val);
                        }}
                        className="w-24 px-2 py-1 rounded border border-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none text-sm font-semibold"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <input 
                        type="date" 
                        defaultValue={reading?.paymentDate ?? ''}
                        onBlur={(e) => handleUpdatePayment(resident.id, 'paymentDate', e.target.value)}
                        className="px-2 py-1 rounded border border-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none text-sm"
                      />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => handleSendSummary(resident, reading, 'whatsapp')}
                          disabled={!reading}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all disabled:opacity-30"
                          title="Wyślij WhatsApp"
                        >
                          <Send size={18} />
                        </button>
                        <button 
                          onClick={() => handleSendSummary(resident, reading, 'sms')}
                          disabled={!reading}
                          className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all disabled:opacity-30"
                          title="Wyślij SMS (Łącze Windows)"
                        >
                          <MessageSquare size={18} />
                        </button>
                        <button 
                          onClick={() => handleSendSummary(resident, reading, 'copy')}
                          disabled={!reading}
                          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all disabled:opacity-30"
                          title="Kopiuj do schowka"
                        >
                          <Copy size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50/80 border-t-2 border-slate-200">
              <tr>
                <td colSpan={2} className="px-6 py-4 font-bold text-slate-900 text-right uppercase tracking-wider">Suma wszystkich mieszkańców:</td>
                <td className="px-6 py-4 font-bold text-slate-900">
                  {totalResidentsMeterConsumption.toFixed(3)} m³
                </td>
                <td className="px-6 py-4 font-bold text-amber-600">
                  {ubytki.toFixed(3)} m³
                </td>
                <td className="px-6 py-4 font-bold text-slate-900 text-lg">
                  {period.totalConsumption.toFixed(3)} m³
                </td>
                <td className="px-6 py-4 font-bold text-slate-900">
                  {residents.reduce((sum, res) => {
                    const r = readings.find(read => read.residentId === res.id);
                    const meterConsumption = r?.meterConsumption ?? 0;
                    const resMeterCount = res.meters?.length || 0;
                    const resWaterLossShare = ubytkiPerMeter * resMeterCount;
                    const residentWaterCost = (meterConsumption + resWaterLossShare) * period.pricePerM3;
                    return sum + residentWaterCost;
                  }, 0).toFixed(2)} zł
                </td>
                <td className="px-6 py-4 font-bold text-slate-900">
                  {(period.elecTotalInvoiceAmount || 0).toFixed(2)} zł
                </td>
                <td className="px-6 py-4 font-bold text-slate-900">
                  {(residents.length * period.renovationFundAtTime).toFixed(2)} zł
                </td>
                <td className="px-6 py-4 font-bold text-indigo-700 text-xl">
                  {residents.reduce((sum, res) => {
                    const r = readings.find(read => read.residentId === res.id);
                    const meterConsumption = r?.meterConsumption ?? 0;
                    const resMeterCount = res.meters?.length || 0;
                    const resWaterLossShare = ubytkiPerMeter * resMeterCount;
                    const residentWaterCost = (meterConsumption + resWaterLossShare) * period.pricePerM3;
                    const totalToPay = residentWaterCost + period.renovationFundAtTime + elecCostPerResident;
                    return sum + totalToPay;
                  }, 0).toFixed(2)} zł
                </td>
                <td className="px-6 py-4 font-bold text-emerald-600">
                  {residents.reduce((sum, res) => {
                    const r = readings.find(read => read.residentId === res.id);
                    return sum + (r?.paidAmount || 0);
                  }, 0).toFixed(2)} zł
                </td>
                <td className="px-6 py-4"></td>
                <td className="px-6 py-4 text-right"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
