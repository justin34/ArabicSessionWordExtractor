import { APP_NAME } from '../../core/appIdentity';
import './Sidebar.css';

export type Destination = 'sessions' | 'vocabulary' | 'settings' | 'credits';

const ITEMS: Array<{ id: Destination; label: string }> = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'vocabulary', label: 'Vocabulary' },
  { id: 'settings', label: 'Settings' },
  { id: 'credits', label: 'Credits' },
];

export function Sidebar({
  active,
  onNavigate,
}: {
  active: Destination;
  onNavigate: (d: Destination) => void;
}) {
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar__brand">{APP_NAME}</div>
      <ul className="sidebar__list">
        {ITEMS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="sidebar__item"
              aria-current={item.id === active ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
