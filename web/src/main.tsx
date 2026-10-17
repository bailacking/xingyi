import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');
// 不用 StrictMode：dev 下 effect 会跑两遍，会重复开局（本地服务端会真的建两盘）
createRoot(root).render(<App />);
