import styles from './SidebarLayout.module.css';

function SidebarLayout({ title, items, activeItem, onItemChange, children }) {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        {title && <h1 className={styles.title}>{title}</h1>}
        <nav className={styles.nav}>
          {items.map((item) => (
            <button
              key={item.id}
              className={`${styles.navItem} ${activeItem === item.id ? styles.active : ''}`}
              onClick={() => onItemChange(item.id)}
            >
              {item.icon && <span className={styles.icon}>{item.icon}</span>}
              <span className={styles.label}>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className={styles.divider} />

      <main className={styles.content}>
        {children}
      </main>
    </div>
  );
}

export default SidebarLayout;
