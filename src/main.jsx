import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './components/CrashScreen/AppErrorBoundary.jsx'
import { reloadOnNewBuild } from './utils/reloadOnNewBuild'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)

reloadOnNewBuild()
