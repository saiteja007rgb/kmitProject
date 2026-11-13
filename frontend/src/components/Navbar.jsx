import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Activity, LogOut, User, ShieldCheck } from 'lucide-react';

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-100">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-slate-900">ExamPulse</span>
            <span className="hidden sm:inline-block ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              Distributed Assessment
            </span>
          </div>
        </div>

        {user && (
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm text-slate-600 bg-slate-50 py-1.5 px-3 rounded-lg border border-slate-200">
              {user.role === 'candidate' ? (
                <User className="w-4 h-4 text-slate-500" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
              )}
              <span className="font-medium text-slate-800">{user.display_name || user.username}</span>
              <span className="text-xs uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                {user.role}
              </span>
            </div>

            <button
              onClick={logout}
              className="inline-flex items-center space-x-1.5 text-sm text-slate-500 hover:text-rose-600 p-2 rounded-lg hover:bg-rose-50 transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

