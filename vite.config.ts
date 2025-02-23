import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
    build: {
        // 禁用源映射以加快打包速度
        sourcemap: false,
        // 调整块大小警告限制
        chunkSizeWarningLimit: 1000,

        rollupOptions: {
            output: {
                // 手动分块配置
                manualChunks: {
                    // 第三方库分块
                    'vendor': [
                        'vue',
                        '@vitejs/plugin-vue',
                        'electron',
                        '@electron-forge/plugin-vite'
                    ],
                    // UI 组件分块
                    'ui': [
                        './src/components/'
                    ],
                    // 服务分块
                    'services': [
                        './src/services/'
                    ]
                }
            }
        }
    },

    plugins: [vue()],

    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    }
}) 