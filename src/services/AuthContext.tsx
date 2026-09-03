import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut as firebaseSignOut, 
  User, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  serverTimestamp 
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { ConnectionConfig, DiagnosticTroubleCode, VinInfo } from '../types';

export interface FirebaseUserPreferences {
  userId: string;
  language: 'ar' | 'en';
  theme: 'dark' | 'light' | 'automotive-night';
  units: 'metric' | 'imperial';
  transportType: 'WIFI_TCP' | 'BLUETOOTH_SPP';
  ip: string;
  port: number;
  bluetoothDeviceName: string;
  bluetoothMacAddress: string;
  canSpeed: '125K' | '250K' | '500K' | '1M';
  canMode: '11-bit' | '29-bit';
  isMockMode: boolean;
}

export interface FirebaseDiagnosticReport {
  id: string;
  userId: string;
  timestamp: any; // serverTimestamp or ISO Date
  rawVin: string;
  manufacturer: string;
  model: string;
  year: number;
  country: string;
  batteryVoltage: number;
  dtcCodes: string[];
  status: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  preferences: FirebaseUserPreferences | null;
  diagnosticHistory: FirebaseDiagnosticReport[];
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  savePreferences: (prefs: Partial<FirebaseUserPreferences>) => Promise<void>;
  saveDiagnosticReport: (report: Omit<FirebaseDiagnosticReport, 'userId' | 'timestamp'>) => Promise<void>;
  fetchDiagnosticHistory: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [preferences, setPreferences] = useState<FirebaseUserPreferences | null>(null);
  const [diagnosticHistory, setDiagnosticHistory] = useState<FirebaseDiagnosticReport[]>([]);

  // Listen to Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Load settings and diagnostic history for the logged-in user
        await loadUserSettings(currentUser.uid);
        await loadUserDiagnosticHistory(currentUser.uid);
      } else {
        setPreferences(null);
        setDiagnosticHistory([]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 1. Google Sign In
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Google Sign In Error:', error);
      throw error;
    }
  };

  // 2. Sign Out
  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('Sign Out Error:', error);
      throw error;
    }
  };

  // Helper to load settings from Firestore
  const loadUserSettings = async (uid: string) => {
    const path = `users/${uid}/preferences/settings`;
    try {
      const docRef = doc(db, 'users', uid, 'preferences', 'settings');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data() as FirebaseUserPreferences;
        if (data.isMockMode === true) {
          data.isMockMode = false;
          // Optimistically update firestore so it stays real
          setDoc(docRef, { ...data, updatedAt: serverTimestamp() }).catch(console.error);
        }
        setPreferences(data);
      } else {
        // First-time setup, populate with default safe values
        const defaultPrefs: FirebaseUserPreferences = {
          userId: uid,
          language: 'ar',
          theme: 'dark',
          units: 'metric',
          transportType: 'BLUETOOTH_SPP',
          ip: '192.168.4.1',
          port: 35000,
          bluetoothDeviceName: 'ESP32-OBD-PRO',
          bluetoothMacAddress: '00:11:22:33:44:55',
          canSpeed: '500K',
          canMode: '11-bit',
          isMockMode: false,
        };
        await setDoc(docRef, {
          ...defaultPrefs,
          updatedAt: serverTimestamp(),
        });
        setPreferences(defaultPrefs);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  };

  // 3. Save Preferences to Firestore
  const savePreferences = async (newPrefs: Partial<FirebaseUserPreferences>) => {
    if (!user) return;
    const path = `users/${user.uid}/preferences/settings`;
    try {
      const docRef = doc(db, 'users', user.uid, 'preferences', 'settings');
      const mergedPrefs = {
        ...(preferences || {}),
        ...newPrefs,
        userId: user.uid,
        updatedAt: serverTimestamp(),
      } as FirebaseUserPreferences;

      await setDoc(docRef, mergedPrefs);
      setPreferences(mergedPrefs);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  // Helper to load Diagnostic History
  const loadUserDiagnosticHistory = async (uid: string) => {
    const path = `users/${uid}/diagnosticHistory`;
    try {
      const historyQuery = query(
        collection(db, 'users', uid, 'diagnosticHistory')
      );
      const querySnapshot = await getDocs(historyQuery);
      const history: FirebaseDiagnosticReport[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        history.push({
          id: docSnap.id,
          ...data,
        } as FirebaseDiagnosticReport);
      });
      // Sort client-side if serverTimestamp hasn't fully resolved yet or by generic timestamp descending
      history.sort((a, b) => {
        const timeA = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp || 0).getTime();
        const timeB = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp || 0).getTime();
        return timeB - timeA;
      });
      setDiagnosticHistory(history);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  };

  // 4. Manual Refetch of Diagnostic History
  const fetchDiagnosticHistory = async () => {
    if (!user) return;
    await loadUserDiagnosticHistory(user.uid);
  };

  // 5. Save Diagnostic Report to Firestore
  const saveDiagnosticReport = async (report: Omit<FirebaseDiagnosticReport, 'userId' | 'timestamp'>) => {
    if (!user) return;
    const path = `users/${user.uid}/diagnosticHistory/${report.id}`;
    try {
      const docRef = doc(db, 'users', user.uid, 'diagnosticHistory', report.id);
      const fullReport = {
        ...report,
        userId: user.uid,
        timestamp: serverTimestamp(),
      };
      await setDoc(docRef, fullReport);
      
      // Update local state proactively
      setDiagnosticHistory(prev => {
        const exists = prev.some(r => r.id === report.id);
        if (exists) {
          return prev.map(r => r.id === report.id ? { ...r, ...fullReport, timestamp: new Date().toISOString() } : r);
        } else {
          return [{ ...fullReport, timestamp: new Date().toISOString() } as FirebaseDiagnosticReport, ...prev];
        }
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      preferences,
      diagnosticHistory,
      signInWithGoogle,
      signOut,
      savePreferences,
      saveDiagnosticReport,
      fetchDiagnosticHistory,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
