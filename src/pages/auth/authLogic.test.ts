import { describe, expect, it, vi } from 'vitest';

vi.mock('../../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));

const {
  MAX_NAME_LENGTH,
  hasPendingInvite,
  parseInviteInput,
  textLength,
  validateDisplayName,
  validateEmail,
  validateGroupName,
  validatePassword,
} = await import('./authLogic');

const CODE = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 文字

describe('validateEmail', () => {
  it('空・形式違いはエラー、正しければ null', () => {
    expect(validateEmail('')).toBe('メールアドレスを入力してください');
    expect(validateEmail('   ')).toBe('メールアドレスを入力してください');
    expect(validateEmail('abc')).toBe('メールアドレスの形式が正しくありません');
    expect(validateEmail('a@b')).toBe('メールアドレスの形式が正しくありません');
    expect(validateEmail(' mama@example.com ')).toBeNull();
  });
});

describe('validatePassword', () => {
  it('新規登録は 6 文字以上', () => {
    expect(validatePassword('', 'signup')).toBe('パスワードを入力してください');
    expect(validatePassword('12345', 'signup')).toBe('パスワードは 6 文字以上にしてください');
    expect(validatePassword('123456', 'signup')).toBeNull();
  });

  it('ログインは空でなければよい（判定は Firebase に任せる）', () => {
    expect(validatePassword('', 'signin')).toBe('パスワードを入力してください');
    expect(validatePassword('123', 'signin')).toBeNull();
  });
});

describe('表示名・グループ名', () => {
  it('空白だけはエラー', () => {
    expect(validateDisplayName('  ')).toBe('表示名を入力してください');
    expect(validateGroupName('')).toBe('グループ名を入力してください');
  });

  it(`${MAX_NAME_LENGTH} 文字まで（絵文字は 1 文字と数える）`, () => {
    expect(validateDisplayName('あ'.repeat(MAX_NAME_LENGTH))).toBeNull();
    expect(validateDisplayName('あ'.repeat(MAX_NAME_LENGTH + 1))).toBe('表示名は 50 文字以内にしてください');
    expect(validateGroupName('📚'.repeat(MAX_NAME_LENGTH))).toBeNull();
    expect(textLength('📚📚')).toBe(2);
  });

  it('前後の空白は数えない', () => {
    expect(validateGroupName(`  ${'あ'.repeat(MAX_NAME_LENGTH)}  `)).toBeNull();
  });
});

describe('parseInviteInput', () => {
  it('コードだけ', () => {
    expect(parseInviteInput(CODE)).toBe(CODE);
    expect(parseInviteInput(`  ${CODE}\n`)).toBe(CODE);
  });

  it('URL から取り出す', () => {
    expect(parseInviteInput(`https://example.web.app/join/${CODE}`)).toBe(CODE);
    expect(parseInviteInput(`https://example.web.app/join/${CODE}?utm=line`)).toBe(CODE);
  });

  it('共有メッセージ全体から取り出す', () => {
    const text = `「山田家」の本の貸出ノートに招待します。リンクを開いてログインすると参加できます。\nhttps://example.web.app/join/${CODE}`;
    expect(parseInviteInput(text)).toBe(CODE);
  });

  it('全角英数字も受け付ける', () => {
    const wide = CODE.replace(/[A-Za-z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    expect(parseInviteInput(wide)).toBe(CODE);
  });

  it('取り出せなければ null', () => {
    expect(parseInviteInput('')).toBeNull();
    expect(parseInviteInput('こんにちは')).toBeNull();
    expect(parseInviteInput('https://example.web.app/')).toBeNull();
    expect(parseInviteInput('short')).toBeNull();
    expect(parseInviteInput('https://example.web.app/join/../../x')).toBeNull();
  });
});

describe('hasPendingInvite', () => {
  const storage = (value: string | null) => ({ getItem: () => value });

  it('戻り先が招待リンクなら true', () => {
    expect(hasPendingInvite(storage(`/join/${CODE}`))).toBe(true);
    expect(hasPendingInvite(storage('/history'))).toBe(false);
    expect(hasPendingInvite(storage(null))).toBe(false);
    expect(hasPendingInvite(null)).toBe(false);
  });

  it('読み取りで例外が出ても false', () => {
    expect(
      hasPendingInvite({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toBe(false);
  });
});
