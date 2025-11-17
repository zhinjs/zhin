/** @type {import('tailwindcss').Config} */
import path from 'path';
const cwd = process.cwd();

// 安全的路径构建函数，避免扫描特殊文件
const safePath = (...parts) => {
  try {
    return path.resolve(...parts);
  } catch (error) {
    console.warn(`Tailwind 路径构建失败: ${parts.join('/')}`, error.message);
    return '';
  }
};

export default {
    content: [
        "./index.html",
        './src/**/*.{js,ts,jsx,tsx,mdx}',
        './node_modules/@radix-ui/**/*.{js,ts,jsx,tsx}',
        `${cwd}/node_modules/@zhin.js/*/client/**/*.{js,ts,jsx,tsx}`,
        `${cwd}/node_modules/@zhin.js/*/dist/**/*.{js,ts,jsx,tsx}`,
        `${cwd}/plugins/*/client/**/*.{js,ts,jsx,tsx}`,
        `${cwd}/client/**/*.{js,ts,jsx,tsx}`,
    ].filter(Boolean), // 过滤掉空字符串
    theme: {
        extend: {
            colors: {
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))',
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover))',
                    foreground: 'hsl(var(--popover-foreground))',
                },
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))',
                },
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
            },
        },
    },
    darkMode: "class",
    plugins: [],
}
