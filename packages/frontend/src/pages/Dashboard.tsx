import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';
import './Dashboard.css';

export default function Dashboard() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-left">
            <h1>Correspondence</h1>
            <span className="beta-badge">Beta</span>
          </div>
          <div className="header-right">
            {user && (
              <div className="user-info">
                {user.picture && (
                  <img 
                    src={user.picture} 
                    alt={user.name}
                    className="user-avatar"
                  />
                )}
                <div className="user-details">
                  <span className="user-name">{user.name}</span>
                  <span className="user-email">{user.email}</span>
                </div>
                <button onClick={handleLogout} className="btn btn-logout">
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="welcome-section">
          <h2>Welcome to Correspondence</h2>
          <p>Your secure Gmail management interface is ready.</p>
        </div>

        <div className="features-grid">
          <Link to="/emails" className="feature-card feature-card-active">
            <div className="feature-icon">📧</div>
            <h3>Email Management</h3>
            <p>View, organize, and manage your Gmail messages with enhanced features.</p>
            <div className="feature-status feature-status-active">Open</div>
          </Link>

          <div className="feature-card">
            <div className="feature-icon">🏷️</div>
            <h3>Smart Labels</h3>
            <p>Automatically categorize and label your emails for better organization.</p>
            <div className="feature-status">Coming Soon</div>
          </div>

          <div className="feature-card">
            <div className="feature-icon">🔍</div>
            <h3>Advanced Search</h3>
            <p>Find specific emails quickly with powerful search and filter options.</p>
            <div className="feature-status">Coming Soon</div>
          </div>

          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h3>Email Analytics</h3>
            <p>Get insights into your email patterns and communication trends.</p>
            <div className="feature-status">Coming Soon</div>
          </div>
        </div>

        <div className="auth-status">
          <h3>Authentication Status</h3>
          <div className="status-item">
            <span className="status-label">Google OAuth:</span>
            <span className="status-value connected">Connected</span>
          </div>
          <div className="status-item">
            <span className="status-label">Gmail Access:</span>
            <span className="status-value connected">Active</span>
          </div>
          <div className="status-item">
            <span className="status-label">Account:</span>
            <span className="status-value">{user?.email}</span>
          </div>
        </div>
      </main>
    </div>
  );
}