import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Settings } from './Settings';
import './Header.css';

export default function Header() {
  const { user, logout } = useAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout error:', error);
      // Fallback: redirect to login on any error
      window.location.href = '/login';
    }
  };

  const handleSettingsClick = () => {
    setIsSettingsOpen(true);
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
  };

  return (
    <>
      <header className="header">
        <div className="header-content">
          <h1 className="header-title">Correspondence</h1>
          <div className="header-actions">
            <button className="btn btn-secondary">Refresh</button>
            <button 
              className="btn btn-secondary"
              onClick={handleSettingsClick}
            >
              Settings
            </button>
            {user && (
              <div className="header-user">
                <span>{user.email}</span>
                <button onClick={handleLogout} className="btn btn-secondary">
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      
      <Settings 
        isOpen={isSettingsOpen} 
        onClose={handleSettingsClose} 
      />
    </>
  );
}