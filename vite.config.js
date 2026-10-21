import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // the timetable API runs on 3001 (npm run server)
    proxy: { '/api': 'http://localhost:3001' },
  },
});
