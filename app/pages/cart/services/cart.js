'use strict';

angular.module('app.services').service('$cart', function($rootScope, $api, $q, $cookieStore, $window) {

  /*
  * Represents item in cart. Bounty, Pledge, etc.
  * */
  var Item = function(type, amount, attributes) {
    this.class = type;
    this.amount = amount;
    this.attributes = attributes || {};

//    // Added to cart date, if passed on attributes
//    this.added_at = this.attributes.added_at || new Date().getTime();
//    delete this.attributes.added_at;
  };

  /*
  * NOTE: Use $cart.load() to get a Cart object in your controllers.
  * */
  var Cart = function(items) {
    this.items = items || [];

    /*
    * Request checkout using a specific payment method.
    * Depending on the payment method, a third-party redirect may be necessary.
    *
    * @param checkout_method - the name of the checkout method to use
    * @return promise of checkout data
    *
    * Checkout data has the following attributes:
    *   redirect_url - if checkout method requires redirect, this is where to redirect to for third-party checkout.
    *
    * */
    this.checkout = function(checkout_method) {
      var deferred = $q.defer();

      $api.cart_checkout(checkout_method).then(function(response) {
        if (checkout_method === 'google') {
          // a JWT is returned, trigger Google Wallet buy
          $window.google.payments.inapp.buy({
            jwt: response.jwt,

            success: function(result) {
              var query = $api.toKeyValue({
                access_token: $api.get_access_token(),
                order_id: result.response.orderId
              });

              $window.location = $rootScope.api_host + "payments/google/success?" + query;
            },

            failure: function() {
              deferred.resolve();
            }
          });
        } else if (checkout_method === 'paypal') {
          // PayPal is going to redirect, do not resolve the promise.
          // deferred.reject(response);

        } else {
          deferred.resolve(response);
        }
      });

      return deferred.promise;
    };

    /*
     * Add item to the cart.
     *
     * @param type - the type of item. "Pledge" "Bounty" etc.
     * @param price - the price of item.
     * @param attributes - optional attributes for the item.
     * @return promise of the new Item
     * */
    this.add_item = function(type, amount, attributes) {
      attributes = attributes || {};

      var deferred = $q.defer();

      var item = new Item(type, amount, attributes);
      this.items.push(item);

      // Add item to server-side cart if logged in.
      this._require_person().then(function(person) {
        if (person) {
          $api.cart_add_item(item.class, item.amount, item.attributes).then(function(updated_cart) {
            deferred.resolve(item);
          });
        } else {
          deferred.resolve(item);
        }
      });

      return deferred.promise;
    };

    /*
    * Helper method to add a pledge to the cart.
    * @return promise of pledge Item
    * */
    this.add_pledge = function(amount, fundraiser, attributes) {
      attributes = attributes || {};
      attributes.fundraiser_id = fundraiser.id;
      return this.add_item('Pledge', amount, attributes);
    };

    /*
     * Helper method to add a bounty to the cart.
     * */
    this.add_bounty = function(amount, issue, attributes) {
      attributes = attributes || {};
      attributes.issue_id = issue.id;
      return this.add_item('Bounty', amount, attributes);
    };

    /*
    * Remove item from the cart.
    *
    * @param index - the location of the item to remove.
    * @return promise of the removed Item
    * */
    this.remove_item = function(index) {
      var deferred = $q.defer();

      // Remove item from local cart
      var removed_item;
      for (var i=0; i<this.items.length; i++) {
        if (this.items.index === index) {
          removed_item = angular.copy(this.items[i]);
          this.items.splice(i,1);
          break;
        }
      }

      // Remove cart on server
      this._require_person().then(function(person) {
        if (person) {
          $api.cart_remove_item(index).then(function(updated_cart) {
            deferred.resolve(removed_item);
          });
        } else {
          deferred.resolve(removed_item);
        }
      });

      return deferred.promise;
    };

    /*
    * Update item in the cart with new attributes.
    * Pushes updates to server-side cart
    *
    * @param index - the location of the item to update.
    * @param attributes - the changes to apply to the item.
    * @return self
    * */
    this.update_item = function(index, attributes) {
      var deferred = $q.defer();

      // Update local version of item
      var updated_item;
      for (var i=0; i<this.items.length; i++) {
        if (this.items[i].index === index) {
          for (var k in attributes) {
            this.items[i][k] = attributes[k];
          }
          updated_item = this.items[i];
          break;
        }
      }

      // Update item on server
      this._require_person().then(function(person) {
        if (person) {
          $api.cart_update_item(index, updated_item.attributes).then(function(updated_cart) {
            deferred.resolve(updated_item);
          });
        } else {
          deferred.resolve(updated_item);
        }
      });

      return deferred.promise;
    };

    /*
     * Clear the cart of all items.
     * Pushes updates to server-side cart
     *
     * @return promise of self
     * */
    this.clear = function() {
      var deferred = $q.defer();

      this.items = [];

      this._require_person().then(function(person) {
        if (person) {
          $api.clear_cart().then(function(updated_cart) {
            deferred.resolve(this);
          });
        } else if (person === false) {
          deferred.resolve(this);
        }
      });

      return deferred.promise;
    };

    /*
     * Export local cart to server.
     * NOTE: client-side changes always overwrite server-side attributes.
     *
     * @return promise of updated self.
     * */
    this._export = function() {
      var deferred = $q.defer();

      if (this.items.length <= 0) {
        deferred.resolve(this);
      } else {
        this._require_person().then(function(person) {
          if (person) {
            $api.export_cart().then(function(updated_cart) {
              deferred.resolve(updated_cart);
            });
          } else {
            deferred.reject();
          }
        });
      }

      return deferred.promise;
    };

    /*
    * Helper method to require authenticated person.
    *
    * @return promise of authenticated person
    * */
    this._require_person = function() {
      var deferred = $q.defer();

      $rootScope.$watch('current_person', function(person) {
        if (person) {
          deferred.resolve(person);
        } else if (person === false) {
          deferred.resolve(false);
        }
      });

      return deferred.promise;
    };
  };

  /*
  * Load shopping cart. If you're authenticated, load from server.
  * Otherwise, load client-side cart from cookie.
  *
  * @return promise of the cart object.
  * */
  this.load = function() {
    var deferred = $q.defer();

//    // If logged in, get cart from server, after exporting local cart
//    $rootScope.$watch('current_person', function(person) {
//      var local_cart = $cookieStore.get('cart') || new Cart();
//
//      if (person) {
//        local_cart._export().then(function(updated_cart) {
//          var local_cart = new Cart(updated_cart);
//          $cookieStore.put('cart', local_cart);
//          deferred.resolve(local_cart);
//        });
//      } else if (person === false) {
//
//        deferred.resolve(local_cart);
//      }
//    });

    var cart = new Cart();
    deferred.resolve(cart);

    return deferred.promise;
  };

});