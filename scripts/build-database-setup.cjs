const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, '../dashboard');
function buildSetup() {
    const files = ['schema.sql', 'account-access.sql', 'card-themes.sql', 'account-settings.sql', 'company-branding.sql'];
    const source = files.map(file => `\n-- Source: ${file}\n` + fs.readFileSync(path.join(directory, file), 'utf8')
        .replace(/\r\n/g, '\n').replace(/^begin;\s*$/gmi, '').replace(/^commit;\s*$/gmi, '')).join('\n');
    return '-- BlipLink: complete Supabase setup and upgrade. Copy this whole file into SQL Editor and Run.\n' +
        '-- Existing profiles, card URLs, account types, limits, and access dates are preserved.\n' +
        '-- Manage new and existing accounts in Table Editor > public.account_settings.\n' +
        'begin;\n' + source.trim() + '\ncommit;\n';
}
if (require.main === module) fs.writeFileSync(path.join(directory, 'setup.sql'), buildSetup());
module.exports = { buildSetup };
