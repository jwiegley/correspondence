import { useAuth } from '../hooks/useAuth';
import './Header.css';

export default function Header() {
  const { user } = useAuth();

  const handleLogout = async () => {
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    window.location.href = '/login';
  };

  return (
    <header className="header">
      <div className="header-content">
        <h1 className="header-title">Correspondence</h1>
        <div className="header-actions">
          <button className="btn btn-secondary">Refresh</button>
          <button className="btn btn-secondary">Settings</button>
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
  );
}