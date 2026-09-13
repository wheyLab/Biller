import { BillingApp } from './components/BillingApp';
import { AdminApp } from './components/AdminApp';

// No router library. The admin screen is reached only by typing /admin; it is
// never linked from the billing screen.
export function App() {
  const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';
  return isAdmin ? <AdminApp /> : <BillingApp />;
}
