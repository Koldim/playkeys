# PlayKeys

Витрина цифровых товаров (ниша GGSel). Этап 1 - оформление и выдача; этап 2 - live-каталог, гонка за последнюю единицу, бронь с таймером, устойчивость покупки и поиск.

Репозиторий: [https://github.com/Koldim/playkeys](https://github.com/Koldim/playkeys)  

Демо: [https://dmitriyfedorov.site](https://dmitriyfedorov.site)

## Запуск

    docker compose up -d

    cd backend

    cp .env.example .env

    npm install

    npm start

[http://localhost:3000](http://localhost:3000) - витрина, `/admin.html` - админка (токен `dev-admin-token`).

## Ключевые решения

- Бронь ключа на `create` (до оплаты): `INSERT order` -> `FOR UPDATE SKIP LOCKED` -> `keys.status = reserved`.
- Живая витрина: SSE `GET /api/events` `catalog.snapshot`, `product.updated`) + запасной refetch.
- Webhook идемпотентен по `event_id`; оплата после истечения брони не оставляет paid без товара.
- Промокод списывается при оплате, на create - только preview.
- Поиск: debounce + `AbortController`, фильтры в `?q=` / `?type=`.



## Тесты

Сервер должен быть запущен.

    npm run test:race

    npm run test:webhook-before

    npm run test:promo

    npm run test:last-unit

    npm run test:hold-expire

    npm run test:pay-idempotency

    npm run test:pay-vs-expire

## Живая витрина

Две вкладки с главной. Цена и наличие приходят по SSE `GET /api/events`).

Сменить цену:

    curl -X PATCH [http://localhost:3000/admin/products/KEY-CS2-PRIME](http://localhost:3000/admin/products/KEY-CS2-PRIME) \

      -H "Authorization: Bearer dev-admin-token" \

      -H "Content-Type: application/json" \

      -d '{"price": 1490}'

Скрыть товар (кнопка "Купить" гаснет без распродажи ключей):

    curl -X PATCH [http://localhost:3000/admin/products/KEY-CS2-PRIME](http://localhost:3000/admin/products/KEY-CS2-PRIME) \

      -H "Authorization: Bearer dev-admin-token" \

      -H "Content-Type: application/json" \

      -d '{"available": false}'

Бронь ключа сразу уменьшает остаток на всех вкладках. Если товар подорожал до оплаты, новая сумма видна на `order.html`.

## Последняя единица

    npm run test:last-unit

Один `201`, второй `409 sold_out`. У проигравшего нет оплачиваемого заказа.

Вручную: оставить 1 ключ на SKU, две вкладки -> "Купить" почти одновременно.

## Бронь

TTL: `HOLD_TTL_SEC` (по умолчанию 240). На `order.html` обратный отсчёт; после истечения оплата скрыта, ключ снова в продаже.

    npm run test:hold-expire

Поиск в шапке; в адресе остаются `?q=` и `?type=`.