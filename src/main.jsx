import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ConfirmProvider } from './components/ConfirmDialog.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#141414',
              color: '#e8e8e8',
              border: '1px solid #262626',
              fontSize: '14px',
            },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
