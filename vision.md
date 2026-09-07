# Descrição da visão do app. Não é limitador de design, apenas ponto de partida.

# App SL Fake Bets, plataforma de fácil uso, for fun, para criar bets sobre assuntos aleatórios entre amigos, crie um grupo/time, convide seus amigos, crie quantas bets quiser sobre qualquer assunto estúpido e use moedas falsas da propria plataforma para apostar.

## Pilar de ux do projeto: Onboarding mais fácil possível, manter-se conectado (segurança de auth não é prioridade), acessibilidade (tanto em questão de perofrmance para pcs/aparelhos ruins quanto para convites e usabilidade), tentar ao maximo não expirar links de convite.

## Backend stack: custo-zero inicialmente para prototipagem e early access, setup fácil, manutenção fácil (o mais importante), mas bem documentado para escalar no futuro caso necessário. O backend tem que proporcionar possibilidade de atualização de dados em tempo real, para que outros usuarios vejam apostas e criação de bets novas em tempo real sem muito delay. A Auth tem que ser super fácil então temos que tentar implementar os métodos mais faceis de login (só email, google...).

## Onboarding: tem que encorajar o usuário a finalizar o onboarding, isso significa ajudar ao maximo ser facil, toda vez que solicitar algo como nome, foto de perfil, qualquer coisa do tipo customizável já tem que ter um placeholder pro usuário preguiçoso poder skipar, mas pra possibilitar o usuário que se importa com a imagem fazer algo que seja só dele.

## Team management: A pessoa que criar o time é o lider por padrão, na hora de criar um time tem que ter opção pro lider deixar como um free-for-all que qualquer um cria novas bets e convida novas pessoas, ou algo mais limitado, permitindo apenas moderadores fazer isso. Não precisamos de muitos roles, apenas moderador ou team member normal.

## Bets: Ao criar uma bet nova o usuário tem que definir o titulo, as opções e um tempo para fechar a bet (dar 3 opções de duração facil com uma ja pre-selecionada mas também deixar escolher uma data-hora final). Apenas o criador da bet ou um moderador pode fechar ela antes do tempo. Deve ser possível também colocar um icone ou imagem para ser exibido ao lado do titulo da bet, os icones podem ser emojis de inicio, depois pensamos num set de icones próprio da plataforma.

## Fake coins: nome da moeda falsa da plataforma a decidir (aceito sugestões). Cada usuário novo tem que ter um número de fake coins de onboarding razoavel. Logar frequentemente no app tem que dar nvoas moedas pra quem ja gastou tudo, algo do tipo toda vez que você loga pela primeira vez no dia você ganha 5 moedas, sendo o valor de onboarding 100 ou algo assim, temos que dar fine tuning depois. Feature de poder doar moedas pra um amigo deve entrar na lista de features futuras depois do MVP. O lider do grupo pode injetar moedas em qualquer membro do time. Tem que haver um histórico de transferencias entre usuarios e injeções de moedas para não bagunçar, mas não precisa muito de histórico de todas as bets, talvez só um histórico pra cada usuario de profits e losses.

## Dashboard: Não pode ser dificil de achar bets atuais rolando no seu time, não podemos pedir pro usuario navegar muito, o dashboard principal do app de quem ta logado deve mostrar logo de cara as bets mais recentes, com enfase em bets em aberto e mostrando primeiro as que vao finalizar mais cedo. Se o usuário estiver participando de varios times um seletor de times deve estar no top bar (ou sidebar, estou aberto a opções de design). Trocar o seletor de times deve mudar o app todo para esse time novo. Abrir o app denovo depois de ja ter logado no passado tem que cair logo no dashboard do primeiro time do usuário, precisamos de um modelo estilo Discord que quase nunca você cai numa tela de login ou numa hero page, sempre tentando jogar o usuario direto pro app.

## Estrutura em modais: O ideal é não navegar o usuario para fazer coisas simples, se ele receber um convite para um novo time, ou um link de share de uma bet nova, ou se ele quiser trocar algo do proprio perfil ou criar uma nova bet, fazer uma nova aposta, nada disso deve ser navegado para uma pagina nova, sempre abrindo modais para ele não precisar navegar. Óbvio que algumas coisas vão precisar navegar tipo abrir a pagina de uma bet especifica para ver as odds de uma forma mais bonita e ver quanto outras pessoas apostaram e quem ta participando, mas sempre tem que ter a possibilidade de participar de uma bet ou algo do tipo sem ter que abrir a pagina, apenas um modal satisfaz.

## Mono repo: Tanto o backend quanto o front end desse projeto tem que viver nessa pasta, mas pode ser separado em pastas frontend/backend/mobile, apesar que mobile vai ficar vazia porque é muito no futuro.

## SEO: É muito importante que o app seja otimizado para SEO e para IAs encontrarem também, esse é o tipo de app que pode rolar de boca em boca entre amigos, quando alguém tem uma ideia de fazer uma beta interna vão jogar no google para tentar achar algum app que faça isso.

## Chat/comentários: É bom que cada bet, na sua pagina de detalhes, tenha um mini chat, algo como uma seção de comentários para os usuários poderem falar sobre a bet um dos outros. Mais pra frente podemos fazer um chat global do time para usuários chamarem os outros a criar uma bet ou só conversar entre si.

## Identidade visual: Deve ser branco e preto, tendo como ancestral o old-soulless-bg na root do projeto, mas nunca usar soulless por extenso no app, vamos seguir com SL e deixar sem explicação. Não usar a imagem old-soulless-bg, mas sim gerar novos icones com base nesse (o S estilizado pode ser reutilizado 1 pra 1) quando necessário.

## Dev env: Enquanto eu não disser explicitamente que vamos mover para desenvolver com dados em uma db de verdade nós vamos seguir com placeholders para que eu possa enxergar próximo do produto final o mais rápido possível. Isso significa que no primeiro protótipo ja vamos ter um time aleatório mostrando com bets e usuarios aleatorios apostando e comentando mas nada disso ainda vai estar numa DB. O primeiro draft vai ser só frontend, depois passamos para criar um backend 100% local e por fim um backend hosteado mas ainda de dev.

## Perfil do usuário: Devemos começar com personalização do usuario simples estilo Twitch. Nome de exibição, cor do nome nos chats e bets, um set de icones para escolher como imagem de perfil mas também possibilidade de dar upload em uma imagem.

## Mecanicas de aposta: Saldo por time, sem saldo negativo (deixar para o futuro), modelo de odds pari-mutuel (estilo as apostas de channel points na twitch). Aposta máxima decidida pelo criador da bet, recomendar um valor igual ao valor de pontos grátis de onboarding como o default.

## Resolução da bet: O criador da bet ou qualquer moderador pode definir o vencedor. Anotar pro futuro permitir criar bets em que o resultado final pode ser definido se um numero determinado de pessoas apontar o mesmo vencedor. Permitir o criador/moderador dar como empate ou nula a bet e devolver os pontos. Timeline da bet deve ter fechado para apostas e também resolvida, o horário que o criador da bet define na criação é o horário que fecha para novas apostas.

## Notificações: Sem notificações no mvp, ter em mente no design do backend que num futuro pode vir a ter notifs.

## Engajamento/retenção: Leaderboard do time com mais ricos e um 'pódio dos pobres'com os top maiores perdedores. Badges no nome em chats e bets para mostrar se o usário é top 5, bottom 5, rank 1, 2 ou 3.

## Moderação: Chat, titulos, imagens serão livres, mas tem que possibilitar lideres/moderadores kickarem ou banirem usuários, removendo todas as apostas que fizeram em bets ativas. Deletar time/bet deve ser hard, mas tem que ter avisos e safeguards (tipo digite o nome do time no modal para garantir q não foi sem querer).

## Compartilhamento: Preview social, os links de convite para time devem ter o nome do time, link de compartilhamento de bets tem que ter o titulo e odds atuais e texto...

## UI/UX responsivo para mobile (versão web quando aberta em um celular tem que ser de boa visualização).

## Escala/limites: Começar com um numero pequeno de times (penso max 30 pessoas), vamos fazer o app todo em inglês de inicio, deixar tradução pt-br pro futuro.

## Operacional : Observabilidade/analytics mínima: funil de onboarding, quantos convites viram cadastro. Feature flags para ligar features pós-MVP sem deploy.

## Visual vibe: O app deve ser descontraido. A identidade visual atende perfeitamente o gosto, mas o target audience do app é grupos de amigos se divertindno com coisas estupidas e zuando uns aos outros. Os botões, textos, helper texts, tooltips, devem ser mais descontraidos. Make fun of the losers, make the winners feel cocky. Mas sem exageros, não queremos que vire um app de tiktoker trying too hard to be funny.
