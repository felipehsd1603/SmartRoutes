const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    'https://mxzijqqldljsjqpymrib.supabase.co',
    'sb_secret_dOhpwsR4H67PfisTd-MLqQ_a1pALtx4'
);

async function uploadOldFiles() {
    const uploadDir = path.resolve(__dirname, 'public/uploads');
    if (!fs.existsSync(uploadDir)) return;
    
    const files = fs.readdirSync(uploadDir);
    for (const file of files) {
        const filePath = path.join(uploadDir, file);
        const fileBuffer = fs.readFileSync(filePath);
        console.log(`Subindo: ${file}...`);
        
        const { error } = await supabase.storage
            .from('images')
            .upload(file, fileBuffer, {
                contentType: 'image/jpeg',
                upsert: true
            });
            
        if (error) console.error(`Erro ao subir ${file}:`, error.message);
        else console.log(`${file} subida com sucesso!`);
    }
    process.exit(0);
}

uploadOldFiles();
