.badge-beta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.05));
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.35);
  font-size: 10px;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 20px;
  margin-left: auto;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.15);
}

.badge-beta::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #f59e0b;
  box-shadow: 0 0 6px #f59e0b;
  animation: betaPulse 1.8s infinite ease-in-out;
}

@keyframes betaPulse {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.2); }
}