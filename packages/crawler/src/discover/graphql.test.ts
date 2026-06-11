import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isGraphqlCapture, parseGraphqlOperationName } from './graphql.js';

describe('parseGraphqlOperationName', () => {
  it('parses operationName from JSON body', () => {
    const body = JSON.stringify({
      operationName: 'ProductSearch',
      query: 'query ProductSearch { products { id } }',
    });
    assert.equal(parseGraphqlOperationName(body), 'ProductSearch');
  });

  it('parses named operation from raw query string', () => {
    const body = 'query CatalogProducts($first: Int!) { products(first: $first) { edges { node { id } } } }';
    assert.equal(parseGraphqlOperationName(body), 'CatalogProducts');
  });

  it('returns null for non-graphql payloads', () => {
    assert.equal(parseGraphqlOperationName('{"products":[]}'), null);
  });
});

describe('isGraphqlCapture', () => {
  it('detects graphql URL and operation name', () => {
    assert.equal(
      isGraphqlCapture({
        url: 'https://shop.example.com/api/graphql',
        contentType: 'application/json',
        graphqlOperationName: 'SearchProducts',
      }),
      true,
    );
  });
});
