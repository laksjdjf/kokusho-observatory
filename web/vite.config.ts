import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages はサブパス（/<repo>/）配信になるため相対ベースにしておく。
// これで project site / user site / ローカル preview のどれでも動く。
// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
})
