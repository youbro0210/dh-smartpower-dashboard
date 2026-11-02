/**
 * 업무용 화면 Tailwind 프리셋
 *
 * Tailwind v3: tailwind.config.js 에서
 *   presets: [require('./tailwind-preset.js')]
 *
 * Tailwind v4: globals.css 에 아래 @theme 블록을 대신 넣는다.
 *   @theme {
 *     --color-primary: #1f3a5f;  --color-line: #d0d5dd;  --color-head: #f2f4f7;
 *     --color-ink: #1d2939;      --color-sub: #475467;   --color-muted: #98a2b3;
 *     --color-danger: #c4320a;   --color-success: #067647;
 *     --radius-sm: 2px; --radius: 2px; --radius-md: 4px;
 *     --font-sans: "Pretendard Variable", Pretendard, -apple-system, sans-serif;
 *   }
 *
 * 둥근 모서리·큰 그림자를 아예 쓸 수 없도록 기본값을 덮어쓴다.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#1f3a5f', hover: '#17304f', soft: '#e8f0fa' },
        line: { DEFAULT: '#d0d5dd', strong: '#98a2b3' },
        head: '#f2f4f7',
        ink: '#1d2939',
        sub: '#475467',
        muted: '#98a2b3',
        danger: '#c4320a',
        success: '#067647',
        warning: '#b54708',
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', '-apple-system', '"Malgun Gothic"', 'sans-serif'],
      },
      fontSize: {
        xs: ['12px', '18px'],
        sm: ['13px', '20px'],
        base: ['14px', '22px'],
        lg: ['16px', '24px'],
      },
      height: { row: '32px', head: '34px', ctl: '30px' },
    },
    // 덮어쓰기: 큰 모서리·그림자 제거
    borderRadius: {
      none: '0', sm: '2px', DEFAULT: '2px', md: '4px',
      lg: '4px', xl: '4px', '2xl': '4px', '3xl': '4px', full: '4px',
    },
    boxShadow: {
      none: 'none',
      sm: '0 1px 2px rgba(16,24,40,0.06)',
      DEFAULT: '0 1px 2px rgba(16,24,40,0.06)',
      md: '0 1px 2px rgba(16,24,40,0.06)',
      lg: '0 2px 6px rgba(16,24,40,0.10)',   /* 드롭다운·모달 전용 */
      xl: '0 2px 6px rgba(16,24,40,0.10)',
      '2xl': '0 2px 6px rgba(16,24,40,0.10)',
    },
  },
};
