import xml.etree.ElementTree as ET
import os
import csv
import math
from pathlib import Path

def haversine(lat1, lon1, lat2, lon2):
    """Calcula a distancia entre dois pontos em km usando formula de Haversine"""
    R = 6371  # Raio da Terra em km

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    return R * c

def identificar_cidade(lat, lon):
    """Identifica a cidade aproximada baseado nas coordenadas"""
    # Mapeamento de regioes conhecidas em MG e RJ
    cidades = [
        {"nome": "Lagoa Santa", "estado": "MG", "lat": -19.63, "lon": -43.89, "raio": 0.15},
        {"nome": "Nova Lima", "estado": "MG", "lat": -20.00, "lon": -43.85, "raio": 0.20},
        {"nome": "Belo Horizonte", "estado": "MG", "lat": -19.92, "lon": -43.94, "raio": 0.15},
        {"nome": "Sabara", "estado": "MG", "lat": -19.88, "lon": -43.81, "raio": 0.10},
        {"nome": "Santa Luzia", "estado": "MG", "lat": -19.77, "lon": -43.85, "raio": 0.10},
        {"nome": "Confins", "estado": "MG", "lat": -19.63, "lon": -43.97, "raio": 0.08},
        {"nome": "Pedro Leopoldo", "estado": "MG", "lat": -19.62, "lon": -44.04, "raio": 0.10},
        {"nome": "Vespasiano", "estado": "MG", "lat": -19.69, "lon": -43.92, "raio": 0.08},
        {"nome": "Ribeirao das Neves", "estado": "MG", "lat": -19.77, "lon": -44.09, "raio": 0.10},
        {"nome": "Contagem", "estado": "MG", "lat": -19.93, "lon": -44.05, "raio": 0.12},
        {"nome": "Betim", "estado": "MG", "lat": -19.97, "lon": -44.20, "raio": 0.12},
        {"nome": "Ouro Preto", "estado": "MG", "lat": -20.38, "lon": -43.50, "raio": 0.20},
        {"nome": "Mariana", "estado": "MG", "lat": -20.38, "lon": -43.42, "raio": 0.15},
        {"nome": "Itabirito", "estado": "MG", "lat": -20.25, "lon": -43.80, "raio": 0.15},
        {"nome": "Brumadinho", "estado": "MG", "lat": -20.15, "lon": -44.20, "raio": 0.15},
        {"nome": "Sao Joao Del Rei", "estado": "MG", "lat": -21.13, "lon": -44.25, "raio": 0.20},
        {"nome": "Tiradentes", "estado": "MG", "lat": -21.11, "lon": -44.17, "raio": 0.10},
        {"nome": "Congonhas", "estado": "MG", "lat": -20.50, "lon": -43.86, "raio": 0.10},
        {"nome": "Conselheiro Lafaiete", "estado": "MG", "lat": -20.66, "lon": -43.78, "raio": 0.12},
        {"nome": "Barbacena", "estado": "MG", "lat": -21.22, "lon": -43.77, "raio": 0.15},
        {"nome": "Juiz de Fora", "estado": "MG", "lat": -21.76, "lon": -43.35, "raio": 0.20},
        {"nome": "Visconde de Maua", "estado": "RJ", "lat": -22.33, "lon": -44.55, "raio": 0.15},
        {"nome": "Penedo", "estado": "RJ", "lat": -22.42, "lon": -44.53, "raio": 0.10},
        {"nome": "Resende", "estado": "RJ", "lat": -22.47, "lon": -44.45, "raio": 0.15},
        {"nome": "Itatiaia", "estado": "RJ", "lat": -22.49, "lon": -44.56, "raio": 0.15},
        {"nome": "Sao Paulo", "estado": "SP", "lat": -23.55, "lon": -46.63, "raio": 0.30},
        {"nome": "Barroso", "estado": "MG", "lat": -21.19, "lon": -43.97, "raio": 0.10},
        {"nome": "Ressaquinha", "estado": "MG", "lat": -21.06, "lon": -43.76, "raio": 0.10},
        {"nome": "Caeté", "estado": "MG", "lat": -19.88, "lon": -43.67, "raio": 0.15},
        {"nome": "Serra do Cipo", "estado": "MG", "lat": -19.35, "lon": -43.60, "raio": 0.20},
        {"nome": "Jaboticatubas", "estado": "MG", "lat": -19.52, "lon": -43.74, "raio": 0.12},
        {"nome": "Regiao de Caete", "estado": "MG", "lat": -19.88, "lon": -43.48, "raio": 0.15},
        {"nome": "Raposos", "estado": "MG", "lat": -19.97, "lon": -43.80, "raio": 0.08},
        {"nome": "Rio Acima", "estado": "MG", "lat": -20.08, "lon": -43.79, "raio": 0.10},
        {"nome": "Topo do Mundo (Nova Lima)", "estado": "MG", "lat": -20.07, "lon": -43.96, "raio": 0.08},
    ]

    for cidade in cidades:
        dist = math.sqrt((lat - cidade["lat"])**2 + (lon - cidade["lon"])**2)
        if dist < cidade["raio"]:
            return f"{cidade['nome']}/{cidade['estado']}"

    # Se nao encontrou, retorna coordenadas aproximadas
    if lat > -20.0 and lat < -19.5 and lon > -44.2 and lon < -43.5:
        return "Regiao Metropolitana BH/MG"
    elif lat < -22.0 and lon < -44.0:
        return "Serra da Mantiqueira/RJ-SP"
    elif lat < -21.0 and lat > -22.0:
        return "Sul de Minas/MG"
    else:
        return f"Lat:{lat:.2f} Lon:{lon:.2f}"

def processar_gpx(caminho_gpx):
    """Processa um arquivo GPX e retorna suas caracteristicas"""
    try:
        tree = ET.parse(caminho_gpx)
        root = tree.getroot()

        # Namespace do GPX
        ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}

        # Extrair nome
        nome = root.find('.//gpx:name', ns)
        nome = nome.text if nome is not None else os.path.basename(caminho_gpx)

        # Extrair tipo
        tipo = root.find('.//gpx:type', ns)
        tipo = tipo.text if tipo is not None else "unknown"

        # Coletar pontos
        pontos = root.findall('.//gpx:trkpt', ns)

        if not pontos:
            return None

        lats = []
        lons = []
        elevacoes = []

        for ponto in pontos:
            lat = float(ponto.get('lat'))
            lon = float(ponto.get('lon'))
            lats.append(lat)
            lons.append(lon)

            ele = ponto.find('gpx:ele', ns)
            if ele is not None:
                elevacoes.append(float(ele.text))

        # Calcular distancia total
        distancia_total = 0
        for i in range(1, len(lats)):
            distancia_total += haversine(lats[i-1], lons[i-1], lats[i], lons[i])

        # Calcular ganho e perda de elevacao
        ganho_elevacao = 0
        perda_elevacao = 0

        if elevacoes:
            for i in range(1, len(elevacoes)):
                diff = elevacoes[i] - elevacoes[i-1]
                if diff > 0:
                    ganho_elevacao += diff
                else:
                    perda_elevacao += abs(diff)

        # Ponto central para identificar cidade
        lat_central = sum(lats) / len(lats)
        lon_central = sum(lons) / len(lons)

        # Elevacao min/max
        ele_min = min(elevacoes) if elevacoes else 0
        ele_max = max(elevacoes) if elevacoes else 0

        # Identificar cidade
        cidade = identificar_cidade(lat_central, lon_central)

        return {
            'nome': nome,
            'tipo': tipo,
            'distancia_km': round(distancia_total, 2),
            'ganho_elevacao_m': round(ganho_elevacao),
            'perda_elevacao_m': round(perda_elevacao),
            'elevacao_min_m': round(ele_min),
            'elevacao_max_m': round(ele_max),
            'desnivel_total_m': round(ganho_elevacao + perda_elevacao),
            'cidade': cidade,
            'lat_central': round(lat_central, 4),
            'lon_central': round(lon_central, 4),
            'num_pontos': len(pontos)
        }

    except Exception as e:
        print(f"Erro ao processar {caminho_gpx}: {e}")
        return None

def classificar_dificuldade(distancia, ganho):
    """Classifica a dificuldade da rota baseado em distancia e ganho de elevacao"""
    # Pontuacao baseada em distancia
    if distancia < 5:
        pt_dist = 1
    elif distancia < 10:
        pt_dist = 2
    elif distancia < 15:
        pt_dist = 3
    elif distancia < 25:
        pt_dist = 4
    else:
        pt_dist = 5

    # Pontuacao baseada em ganho de elevacao
    if ganho < 100:
        pt_ele = 1
    elif ganho < 300:
        pt_ele = 2
    elif ganho < 600:
        pt_ele = 3
    elif ganho < 1000:
        pt_ele = 4
    else:
        pt_ele = 5

    media = (pt_dist + pt_ele) / 2

    if media <= 1.5:
        return "Facil"
    elif media <= 2.5:
        return "Moderada"
    elif media <= 3.5:
        return "Dificil"
    elif media <= 4.5:
        return "Muito Dificil"
    else:
        return "Extrema"

def classificar_tipo_terreno(tipo):
    """Classifica o tipo de terreno"""
    if tipo in ['trail_running', 'trail running']:
        return "Trail"
    elif tipo in ['running', 'run']:
        return "Asfalto/Urbano"
    else:
        return "Misto"

def main():
    diretorio_base = Path(__file__).parent
    diretorio_rotas = diretorio_base / 'routes'

    # Ler routes.csv para mapear nomes
    rotas_csv = {}
    csv_path = diretorio_base / 'routes.csv'
    if csv_path.exists():
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                arquivo = row.get('Nome do arquivo da rota', '')
                nome = row.get('Nome da rota', '')
                if arquivo:
                    rotas_csv[arquivo] = nome

    # Processar todos os GPX
    resultados = []

    # Listar arquivos GPX unicos (remover duplicatas por nome)
    arquivos_gpx = sorted(diretorio_rotas.glob('*.gpx'), key=lambda x: int(x.stem) if x.stem.isdigit() else 0)

    # Processar apenas os primeiros 19 arquivos (rotas unicas, os outros sao duplicatas)
    nomes_processados = set()

    for gpx_file in arquivos_gpx:
        resultado = processar_gpx(gpx_file)
        if resultado:
            # Verificar se ja processamos uma rota com esse nome
            if resultado['nome'] in nomes_processados:
                continue

            # Filtrar apenas corrida
            if resultado['tipo'] not in ['running', 'trail_running', 'run', 'trail running']:
                continue

            nomes_processados.add(resultado['nome'])

            # Adicionar classificacoes
            resultado['dificuldade'] = classificar_dificuldade(
                resultado['distancia_km'],
                resultado['ganho_elevacao_m']
            )
            resultado['terreno'] = classificar_tipo_terreno(resultado['tipo'])
            resultado['arquivo'] = gpx_file.name

            resultados.append(resultado)

    # Ordenar por distancia
    resultados.sort(key=lambda x: x['distancia_km'])

    # Gerar relatorio
    print("\n" + "="*120)
    print("INVENTARIO DE ROTAS DE CORRIDA - Felipe Desiderio")
    print("="*120)
    print(f"\nTotal de rotas unicas de corrida: {len(resultados)}")
    print("\n")

    # Cabecalho
    print(f"{'Nome':<45} {'Dist(km)':<10} {'D+ (m)':<10} {'D- (m)':<10} {'Alt Min':<10} {'Alt Max':<10} {'Dificuldade':<15} {'Terreno':<15} {'Cidade':<30}")
    print("-"*165)

    for r in resultados:
        print(f"{r['nome'][:44]:<45} {r['distancia_km']:<10} {r['ganho_elevacao_m']:<10} {r['perda_elevacao_m']:<10} {r['elevacao_min_m']:<10} {r['elevacao_max_m']:<10} {r['dificuldade']:<15} {r['terreno']:<15} {r['cidade']:<30}")

    # Estatisticas
    print("\n" + "="*120)
    print("ESTATISTICAS")
    print("="*120)

    dist_total = sum(r['distancia_km'] for r in resultados)
    ganho_total = sum(r['ganho_elevacao_m'] for r in resultados)

    print(f"\nDistancia total catalogada: {dist_total:.1f} km")
    print(f"Ganho de elevacao total: {ganho_total:,} m")
    print(f"Media de distancia: {dist_total/len(resultados):.1f} km")
    print(f"Media de ganho de elevacao: {ganho_total/len(resultados):.0f} m")

    # Por dificuldade
    print("\nRotas por dificuldade:")
    dificuldades = {}
    for r in resultados:
        d = r['dificuldade']
        dificuldades[d] = dificuldades.get(d, 0) + 1
    for d, count in sorted(dificuldades.items()):
        print(f"  {d}: {count} rotas")

    # Por terreno
    print("\nRotas por terreno:")
    terrenos = {}
    for r in resultados:
        t = r['terreno']
        terrenos[t] = terrenos.get(t, 0) + 1
    for t, count in sorted(terrenos.items()):
        print(f"  {t}: {count} rotas")

    # Por cidade
    print("\nRotas por cidade/regiao:")
    cidades = {}
    for r in resultados:
        c = r['cidade']
        cidades[c] = cidades.get(c, 0) + 1
    for c, count in sorted(cidades.items(), key=lambda x: -x[1]):
        print(f"  {c}: {count} rotas")

    # Salvar CSV
    csv_output = diretorio_base / 'inventario_rotas_corrida.csv'
    with open(csv_output, 'w', newline='', encoding='utf-8') as f:
        campos = ['nome', 'distancia_km', 'ganho_elevacao_m', 'perda_elevacao_m',
                  'elevacao_min_m', 'elevacao_max_m', 'desnivel_total_m',
                  'dificuldade', 'terreno', 'cidade', 'tipo', 'arquivo']
        writer = csv.DictWriter(f, fieldnames=campos, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(resultados)

    print(f"\n\nInventario salvo em: {csv_output}")

    # Salvar versao detalhada para consulta
    txt_output = diretorio_base / 'inventario_rotas_corrida.txt'
    with open(txt_output, 'w', encoding='utf-8') as f:
        f.write("INVENTARIO DE ROTAS DE CORRIDA\n")
        f.write("="*80 + "\n\n")

        for r in sorted(resultados, key=lambda x: x['cidade']):
            f.write(f"ROTA: {r['nome']}\n")
            f.write("-"*60 + "\n")
            f.write(f"  Cidade/Regiao: {r['cidade']}\n")
            f.write(f"  Distancia: {r['distancia_km']} km\n")
            f.write(f"  Ganho de elevacao (D+): {r['ganho_elevacao_m']} m\n")
            f.write(f"  Perda de elevacao (D-): {r['perda_elevacao_m']} m\n")
            f.write(f"  Elevacao: {r['elevacao_min_m']}m - {r['elevacao_max_m']}m\n")
            f.write(f"  Dificuldade: {r['dificuldade']}\n")
            f.write(f"  Terreno: {r['terreno']}\n")
            f.write(f"  Tipo original: {r['tipo']}\n")
            f.write("\n")

    print(f"Relatorio detalhado salvo em: {txt_output}")

if __name__ == '__main__':
    main()
