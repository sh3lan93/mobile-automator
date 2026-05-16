import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/state/cart_model.dart';
import 'package:sample_shop/ui/screens/cart_screen.dart';
import 'package:sample_shop/ui/screens/categories_screen.dart';
import 'package:sample_shop/ui/screens/home_screen.dart';
import 'package:sample_shop/ui/screens/more_screen.dart';

class RootScaffold extends StatefulWidget {
  const RootScaffold({super.key});
  @override
  State<RootScaffold> createState() => _RootScaffoldState();
}

class _RootScaffoldState extends State<RootScaffold> {
  int _index = 0;

  static const _titles = ['Sample Shop', 'Categories', 'More'];

  @override
  Widget build(BuildContext context) {
    final count = context.watch<CartModel>().totalItems;
    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_index]),
        actions: [
          Semantics(
            identifier: 'appbar_icon_cart',
            button: true,
            child: IconButton(
              icon: Badge(
                isLabelVisible: count > 0,
                label: Text('$count'),
                child: const Icon(Icons.shopping_cart),
              ),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                    builder: (_) => const CartScreen()),
              ),
            ),
          ),
        ],
      ),
      body: IndexedStack(
        index: _index,
        children: const [HomeScreen(), CategoriesScreen(), MoreScreen()],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
        items: [
          BottomNavigationBarItem(
            icon: Semantics(
                identifier: 'bottom_nav_home',
                child: const Icon(Icons.home)),
            label: 'Home',
          ),
          BottomNavigationBarItem(
            icon: Semantics(
                identifier: 'bottom_nav_categories',
                child: const Icon(Icons.category)),
            label: 'Categories',
          ),
          BottomNavigationBarItem(
            icon: Semantics(
                identifier: 'bottom_nav_more',
                child: const Icon(Icons.more_horiz)),
            label: 'More',
          ),
        ],
      ),
    );
  }
}
