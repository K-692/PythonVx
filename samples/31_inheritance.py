# Title: Inheritance
# Group: Classes
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return "..."

class Dog(Animal):
    def speak(self):
        return self.name + " says woof"

pets = [Dog("Rex"), Animal("Generic")]
for pet in pets:
    print(pet.speak())
