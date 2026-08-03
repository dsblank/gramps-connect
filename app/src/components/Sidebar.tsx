import { VIEWS } from "../store/views";

interface SidebarProps {
  activeKey: string;
  onSelect: (key: string) => void;
}

export function Sidebar({ activeKey, onSelect }: SidebarProps) {
  return (
    <nav className="sidebar">
      {VIEWS.map((view) => (
        <button
          key={view.key}
          className={view.key === activeKey ? "active" : undefined}
          onClick={() => onSelect(view.key)}
        >
          {view.label}
        </button>
      ))}
    </nav>
  );
}
